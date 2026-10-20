import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import {
  CAPABILITIES,
  DEFAULT_CONTROL_PORT,
  PAIRING_TTL_MS,
  PROTOCOL_MAX_VERSION,
  PROTOCOL_MIN_VERSION,
  PROTOCOL_VERSION,
  type ControlEnvelope,
  type DiscoveryAnnouncement,
  type FileOffer,
  type PairedDeviceRecord,
  type PairingQrPayload,
  type TransferRecord,
  type TransferState
} from "@nexashare/protocol";
import {
  ERROR_GUIDANCE,
  KeyedRateLimiter,
  NexaError,
  generatePairingCode,
  isFingerprintFormat,
  isTerminal,
  randomUuid,
  sanitizeRelativePath,
  transition
} from "@nexashare/shared";
import { parseControlEnvelope } from "@nexashare/validation";
import { WebSocket, WebSocketServer } from "ws";
import {
  createDeviceIdentity,
  fingerprintFromCertPem,
  pairingProof,
  randomToken,
  requireFingerprint,
  timingSafeEqualHex,
  tokensMatch,
  toPeerIdentity,
  type DeviceIdentity
} from "./crypto.js";
import { pinnedHttpsAgent } from "./tls-pin.js";
import { DiscoveryService, type DiscoveredDevice } from "./discovery.js";
import { receiveFileStream, tempRootFor } from "./incoming.js";
import { loadState, saveState, type PersistedState } from "./persistence.js";

export interface EngineOptions {
  dataDir: string;
  displayName: string;
  port?: number;
  destinationRoot?: string;
  enableDiscovery?: boolean;
}

interface PairingSession {
  id: string;
  code: string;
  expiresAt: number;
  consumed: boolean;
  attempts: number;
}

interface LiveTransfer {
  record: TransferRecord;
  sockets: Set<WebSocket>;
  abort: AbortController;
  existingNames: Set<string>;
}

interface PeerConnection {
  socket: WebSocket;
  deviceId: string;
  authenticated: boolean;
  fingerprintSha256: string;
}

export class NexaEngine extends EventEmitter {
  identity!: DeviceIdentity;
  destinationRoot!: string;
  clipboardSyncEnabled = false;
  onboardingComplete = false;
  readonly paired = new Map<string, PairedDeviceRecord>();
  readonly history: TransferRecord[] = [];
  readonly pendingIncoming = new Map<string, LiveTransfer>();
  private readonly transfers = new Map<string, LiveTransfer>();
  private readonly pairing = new Map<string, PairingSession>();
  private readonly usedNonces = new Set<string>();
  private readonly pairingLimiter = new KeyedRateLimiter(5, 1);
  private readonly authLimiter = new KeyedRateLimiter(10, 2);
  private server: https.Server | null = null;
  private wss: WebSocketServer | null = null;
  private discovery: DiscoveryService | null = null;
  private persistTimer: NodeJS.Timeout | null = null;
  private port: number;
  private readonly dataDir: string;
  private readonly displayName: string;
  private readonly enableDiscovery: boolean;

  constructor(private readonly options: EngineOptions) {
    super();
    this.dataDir = options.dataDir;
    this.displayName = options.displayName;
    this.port = options.port ?? DEFAULT_CONTROL_PORT;
    this.enableDiscovery = options.enableDiscovery !== false;
  }

  get listenPort(): number {
    return this.port;
  }

  snapshot() {
    return {
      identity: toPeerIdentity(this.identity),
      port: this.port,
      destinationRoot: this.destinationRoot,
      clipboardSyncEnabled: this.clipboardSyncEnabled,
      onboardingComplete: this.onboardingComplete,
      paired: [...this.paired.values()].map(({ sessionToken: _sessionToken, ...peer }) => peer),
      history: this.history.slice(-200).map((record) => this.withProgress(record)),
      devices: this.discovery?.list() ?? [],
      transfers: [...this.transfers.values()].map((t) => this.withProgress(t.record)),
      pairing: [...this.pairing.values()]
        .filter((p) => !p.consumed && p.expiresAt > Date.now())
        .map((p) => ({ id: p.id, code: p.code, expiresAt: p.expiresAt }))
    };
  }

  async start(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });
    const statePath = this.statePath();
    const saved = await loadState(statePath);
    if (saved?.identity) {
      this.identity = { ...saved.identity, displayName: this.displayName || saved.identity.displayName };
      this.destinationRoot = this.options.destinationRoot ?? saved.destinationRoot;
      this.clipboardSyncEnabled = saved.clipboardSyncEnabled;
      this.onboardingComplete = saved.onboardingComplete;
      for (const peer of saved.paired) {
        this.paired.set(peer.deviceId, peer);
      }
      for (const record of saved.history) {
        if (!isTerminal(record.state) && record.state !== "interrupted") {
          record.state = "interrupted";
          record.errorCode = "NETWORK";
          record.errorMessage = "Transfer was interrupted by an application restart";
        }
        this.history.push(record);
      }
    } else {
      this.identity = createDeviceIdentity(this.displayName);
      this.destinationRoot = this.options.destinationRoot ?? path.join(this.dataDir, "Downloads");
    }
    await mkdir(this.destinationRoot, { recursive: true });
    await this.listen();
    if (this.enableDiscovery) {
      this.discovery = new DiscoveryService(this.identity.deviceId, () => this.announcement());
      this.discovery.on("devices", (devices: DiscoveredDevice[]) => this.emit("devices", devices));
      await this.discovery.start();
    }
    this.persistTimer = setInterval(() => void this.persist(), 5000);
    await this.persist();
    this.emit("status", this.snapshot());
  }

  async stop(): Promise<void> {
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
    }
    this.discovery?.stop();
    for (const live of this.transfers.values()) {
      live.abort.abort();
    }
    this.wss?.close();
    await new Promise<void>((resolve) => this.server?.close(() => resolve()) ?? resolve());
    await this.persist();
  }

  setDisplayName(name: string): void {
    this.identity.displayName = name.slice(0, 64);
    void this.persist();
    this.emit("status", this.snapshot());
  }

  setDestinationRoot(root: string): void {
    this.destinationRoot = root;
    void this.persist();
    this.emit("status", this.snapshot());
  }

  completeOnboarding(): void {
    this.onboardingComplete = true;
    void this.persist();
    this.emit("status", this.snapshot());
  }

  setClipboardSyncEnabled(enabled: boolean): void {
    this.clipboardSyncEnabled = enabled;
    void this.persist();
    this.emit("status", this.snapshot());
  }

  createPairingSession(): { qr: PairingQrPayload; code: string; expiresAt: number } {
    const session: PairingSession = {
      id: randomUuid(),
      code: generatePairingCode(),
      expiresAt: Date.now() + PAIRING_TTL_MS,
      consumed: false,
      attempts: 0
    };
    this.pairing.set(session.id, session);
    const qr: PairingQrPayload = {
      v: PROTOCOL_VERSION,
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName,
      host: lanIPv4(),
      port: this.port,
      fingerprintSha256: this.identity.fingerprintSha256,
      pairingSessionId: session.id
    };
    this.emit("status", this.snapshot());
    return { qr, code: session.code, expiresAt: session.expiresAt };
  }

  revokeDevice(deviceId: string): void {
    const peer = this.paired.get(deviceId);
    if (!peer) {
      return;
    }
    peer.revoked = true;
    void this.persist();
    this.emit("status", this.snapshot());
  }

  unpairDevice(deviceId: string): void {
    this.paired.delete(deviceId);
    void this.persist();
    this.emit("status", this.snapshot());
  }

  clearHistory(): void {
    this.history.length = 0;
    void this.persist();
    this.emit("status", this.snapshot());
  }

  expirePairingForTests(): void {
    for (const session of this.pairing.values()) {
      session.expiresAt = 0;
    }
  }

  cancelTransfer(transferId: string): void {
    const live = this.transfers.get(transferId);
    if (!live || isTerminal(live.record.state)) {
      return;
    }
    this.broadcast(live, {
      v: PROTOCOL_VERSION,
      requestId: randomUuid(),
      sentAt: Date.now(),
      message: { type: "transfer_cancel", transferId, reason: "User cancelled" }
    });
    this.finish(live, "cancelled", "TRANSFER_CANCELLED", "User cancelled");
  }

  async decideIncoming(transferId: string, accepted: boolean): Promise<void> {
    const live = this.transfers.get(transferId);
    if (!live) {
      throw new NexaError("TRANSFER_NOT_FOUND", "Incoming transfer not found");
    }
    this.setState(live, accepted ? "accepted" : "cancelled");
    this.broadcast(live, {
      v: PROTOCOL_VERSION,
      requestId: randomUuid(),
      sentAt: Date.now(),
      message: {
        type: "transfer_decision",
        transferId,
        accepted,
        reason: accepted ? undefined : "User declined"
      }
    });
    if (!accepted) {
      this.finish(live, "cancelled", "TRANSFER_REJECTED", "User declined");
    }
    this.emit("status", this.snapshot());
  }

  async sendFiles(peer: { host: string; port: number; deviceId?: string }, files: string[]): Promise<string> {
    if (files.length === 0) {
      throw new NexaError("FILE_INVALID", "No files selected");
    }
    const offers: FileOffer[] = [];
    let total = 0;
    for (const [index, filePath] of files.entries()) {
      const info = await stat(filePath);
      if (!info.isFile()) {
        throw new NexaError("FILE_INVALID", `${filePath} is not a file`);
      }
      offers.push({
        index,
        relativePath: sanitizeRelativePath(path.basename(filePath)),
        sizeBytes: info.size
      });
      total += info.size;
    }
    const transferId = randomUuid();
    const paired = peer.deviceId ? this.paired.get(peer.deviceId) : undefined;
    if (!paired || paired.revoked) {
      throw new NexaError("UNAUTHENTICATED", "Pair this device before sending files");
    }
    const record: TransferRecord = {
      transferId,
      direction: "send",
      peerDeviceId: paired.deviceId,
      peerDisplayName: paired.displayName,
      state: "created",
      files: offers,
      totalBytes: total,
      bytesTransferred: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const live: LiveTransfer = {
      record,
      sockets: new Set(),
      abort: new AbortController(),
      existingNames: new Set()
    };
    this.transfers.set(transferId, live);
    this.history.push(record);
    await this.pushOutgoing(peer.host, peer.port, paired, live, files);
    return transferId;
  }

  async pairAsGuest(options: {
    host: string;
    port: number;
    pairingSessionId: string;
    code: string;
    expectedFingerprint: string;
  }): Promise<void> {
    requireFingerprint(options.expectedFingerprint);
    await this.withControlClient(options.host, options.port, options.expectedFingerprint, async (ws) => {
      this.sendWs(ws, {
        v: PROTOCOL_VERSION,
        requestId: randomUuid(),
        sentAt: Date.now(),
        message: {
          type: "pairing_hello",
          pairingSessionId: options.pairingSessionId,
          code: options.code,
          guest: toPeerIdentity(this.identity)
        }
      });
      const challenge = await waitFor(ws, "pairing_challenge");
      if (challenge.message.type !== "pairing_challenge") {
        throw new NexaError("PAIRING_INVALID", "Unexpected pairing message");
      }
      const proof = pairingProof(
        options.code,
        options.pairingSessionId,
        challenge.message.nonce,
        this.identity.deviceId,
        this.identity.fingerprintSha256
      );
      this.sendWs(ws, {
        v: PROTOCOL_VERSION,
        requestId: randomUuid(),
        sentAt: Date.now(),
        message: {
          type: "pairing_proof",
          pairingSessionId: options.pairingSessionId,
          nonce: challenge.message.nonce,
          proofHex: proof,
          guest: toPeerIdentity(this.identity)
        }
      });
      const result = await waitFor(ws, "pairing_result");
      if (result.message.type !== "pairing_result" || !result.message.ok || !result.message.host || !result.message.sessionToken) {
        const code = result.message.type === "pairing_result" ? result.message.errorCode : "PAIRING_INVALID";
        throw new NexaError(code ?? "PAIRING_INVALID", ERROR_GUIDANCE[code ?? "PAIRING_INVALID"]);
      }
      this.paired.set(result.message.host.deviceId, {
        ...result.message.host,
        sessionToken: result.message.sessionToken,
        pairedAt: Date.now(),
        lastSeenAt: Date.now(),
        revoked: false
      });
      await this.persist();
      this.emit("status", this.snapshot());
    });
  }

  private announcement(): DiscoveryAnnouncement {
    return {
      v: PROTOCOL_VERSION,
      type: "announce",
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName,
      port: this.port,
      capabilities: [...CAPABILITIES],
      protocolMin: PROTOCOL_MIN_VERSION,
      protocolMax: PROTOCOL_MAX_VERSION,
      fingerprintSha256: this.identity.fingerprintSha256
    };
  }

  private async listen(): Promise<void> {
    this.server = https.createServer(
      {
        key: this.identity.keyPem,
        cert: this.identity.certPem
      },
      (req, res) => {
        void this.handleHttp(req, res);
      }
    );
    this.wss = new WebSocketServer({ server: this.server });
    this.wss.on("connection", (socket, request) => {
      const fingerprint = tlsFingerprint(request.socket);
      const peer: PeerConnection = {
        socket,
        deviceId: "",
        authenticated: false,
        fingerprintSha256: fingerprint ?? ""
      };
      socket.on("message", (data) => {
        void this.onControl(peer, data.toString("utf8"));
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "0.0.0.0", () => {
        const address = this.server!.address();
        if (address && typeof address === "object") {
          this.port = address.port;
        }
        resolve();
      });
    });
  }

  private async handleHttp(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
    try {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, deviceId: this.identity.deviceId, port: this.port }));
        return;
      }
      const match = /^\/v1\/transfers\/([0-9a-f-]+)\/files\/(\d+)$/i.exec(req.url ?? "");
      if (req.method !== "PUT" || !match) {
        res.writeHead(404);
        res.end();
        return;
      }
      const transferId = match[1]!;
      const fileIndex = Number(match[2]);
      const token = bearer(req.headers.authorization);
      const live = this.transfers.get(transferId);
      if (!live || live.record.direction !== "receive") {
        throw new NexaError("TRANSFER_NOT_FOUND", "Unknown transfer");
      }
      if (live.record.state !== "accepted" && live.record.state !== "transferring") {
        throw new NexaError("TRANSFER_STATE_INVALID", "Transfer is not accepting data");
      }
      const peer = this.paired.get(live.record.peerDeviceId);
      if (!peer || peer.revoked || !tokensMatch(peer.sessionToken, token)) {
        throw new NexaError("UNAUTHENTICATED", "Invalid session");
      }
      const offer = live.record.files.find((f) => f.index === fileIndex);
      if (!offer) {
        throw new NexaError("FILE_INVALID", "Unknown file index");
      }
      this.setState(live, live.record.state === "accepted" ? "connecting" : live.record.state);
      this.setState(live, "transferring");
      const received = await receiveFileStream({
        destinationRoot: this.destinationRoot,
        transferId,
        offer,
        stream: req,
        existingNames: live.existingNames
      });
      live.record.bytesTransferred += received.sizeBytes;
      live.record.updatedAt = Date.now();
      const expected = offer.sha256Hex;
      if (expected && expected.toLowerCase() !== received.sha256Hex) {
        throw new NexaError("HASH_MISMATCH", "SHA-256 mismatch");
      }
      offer.sha256Hex = received.sha256Hex;
      const allDone = live.record.files.every((f) => Boolean(f.sha256Hex));
      if (allDone) {
        this.setState(live, "verifying");
        this.setState(live, "completed");
        await rm(tempRootFor(this.destinationRoot, transferId), { recursive: true, force: true });
        this.finish(live, "completed");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, sha256Hex: received.sha256Hex, sizeBytes: received.sizeBytes }));
      this.emit("status", this.snapshot());
    } catch (error) {
      const nexa = error instanceof NexaError ? error : new NexaError("INTERNAL", (error as Error).message);
      res.writeHead(nexa.code === "UNAUTHENTICATED" ? 401 : 400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, errorCode: nexa.code, message: nexa.message }));
    }
  }

  private async onControl(peer: PeerConnection, raw: string): Promise<void> {
    try {
      const envelope = parseControlEnvelope(raw);
      const message = envelope.message;
      if (message.type === "pairing_hello" || message.type === "pairing_proof") {
        await this.handlePairing(peer, envelope);
        return;
      }
      if (message.type === "auth_hello") {
        this.handleAuth(peer, envelope);
        return;
      }
      if (!peer.authenticated) {
        throw new NexaError("UNAUTHENTICATED", "Authenticate before sending control messages");
      }
      if (message.type === "transfer_offer") {
        await this.handleOffer(peer, envelope);
        return;
      }
      if (message.type === "transfer_decision" || message.type === "transfer_cancel" || message.type === "transfer_progress") {
        const id = "transferId" in message ? message.transferId : "";
        const live = this.transfers.get(id);
        if (!live) {
          return;
        }
        if (message.type === "transfer_cancel") {
          this.finish(live, "cancelled", "TRANSFER_CANCELLED", message.reason);
        }
        if (message.type === "transfer_decision" && !message.accepted) {
          this.finish(live, "cancelled", "TRANSFER_REJECTED", message.reason);
        }
        if (message.type === "transfer_decision" && message.accepted && live.record.direction === "send") {
          this.setState(live, "accepted");
        }
        if (message.type === "transfer_progress" && live.record.direction === "send") {
          live.record.bytesTransferred = message.bytesTransferred;
          live.record.updatedAt = Date.now();
          this.emit("status", this.snapshot());
        }
      }
    } catch (error) {
      const nexa = error instanceof NexaError ? error : new NexaError("MESSAGE_INVALID", (error as Error).message);
      this.sendWs(peer.socket, {
        v: PROTOCOL_VERSION,
        requestId: randomUuid(),
        sentAt: Date.now(),
        message: { type: "transfer_error", errorCode: nexa.code, message: nexa.message }
      });
    }
  }

  private async handlePairing(peer: PeerConnection, envelope: ControlEnvelope): Promise<void> {
    const remote = envelope.message;
    const ip = "pairing";
    if (!this.pairingLimiter.allow(ip)) {
      throw new NexaError("RATE_LIMITED", "Too many pairing attempts");
    }
    if (remote.type === "pairing_hello") {
      const session = this.pairing.get(remote.pairingSessionId);
      if (!session || session.consumed || session.expiresAt < Date.now()) {
        throw new NexaError("PAIRING_EXPIRED", ERROR_GUIDANCE.PAIRING_EXPIRED);
      }
      session.attempts += 1;
      if (session.attempts > 8) {
        session.consumed = true;
        throw new NexaError("RATE_LIMITED", "Pairing session locked");
      }
      const nonce = randomToken(16);
      sessionNonce.set(session.id, nonce);
      this.sendWs(peer.socket, {
        v: PROTOCOL_VERSION,
        requestId: envelope.requestId,
        sentAt: Date.now(),
        message: { type: "pairing_challenge", pairingSessionId: session.id, nonce }
      });
      return;
    }
    if (remote.type !== "pairing_proof") {
      return;
    }
    const session = this.pairing.get(remote.pairingSessionId);
    if (!session || session.consumed || session.expiresAt < Date.now()) {
      throw new NexaError("PAIRING_EXPIRED", ERROR_GUIDANCE.PAIRING_EXPIRED);
    }
    const expectedNonce = sessionNonce.get(session.id);
    if (!expectedNonce || expectedNonce !== remote.nonce || this.usedNonces.has(remote.nonce)) {
      throw new NexaError("PAIRING_INVALID", "Replay or unknown nonce");
    }
    if (!isFingerprintFormat(remote.guest.fingerprintSha256)) {
      throw new NexaError("PAIRING_INVALID", "Guest fingerprint is required");
    }
    const expected = pairingProof(
      session.code,
      session.id,
      remote.nonce,
      remote.guest.deviceId,
      remote.guest.fingerprintSha256
    );
    if (!timingSafeEqualHex(expected, remote.proofHex)) {
      throw new NexaError("PAIRING_INVALID", ERROR_GUIDANCE.PAIRING_INVALID);
    }
    this.usedNonces.add(remote.nonce);
    session.consumed = true;
    const token = randomToken(32);
    this.paired.set(remote.guest.deviceId, {
      ...remote.guest,
      sessionToken: token,
      pairedAt: Date.now(),
      lastSeenAt: Date.now(),
      revoked: false
    });
    await this.persist();
    this.sendWs(peer.socket, {
      v: PROTOCOL_VERSION,
      requestId: envelope.requestId,
      sentAt: Date.now(),
      message: {
        type: "pairing_result",
        ok: true,
        host: toPeerIdentity(this.identity),
        sessionToken: token
      }
    });
    this.emit("status", this.snapshot());
  }

  private handleAuth(peer: PeerConnection, envelope: ControlEnvelope): void {
    if (envelope.message.type !== "auth_hello") {
      return;
    }
    if (!this.authLimiter.allow(envelope.message.deviceId)) {
      throw new NexaError("RATE_LIMITED", "Too many auth attempts");
    }
    const record = this.paired.get(envelope.message.deviceId);
    if (!record || record.revoked) {
      throw new NexaError("DEVICE_REVOKED", ERROR_GUIDANCE.DEVICE_REVOKED);
    }
    if (!tokensMatch(record.sessionToken, envelope.message.sessionToken)) {
      throw new NexaError("UNAUTHENTICATED", "Invalid session token");
    }
    if (this.usedNonces.has(envelope.message.nonce)) {
      throw new NexaError("UNAUTHENTICATED", "Replay detected");
    }
    this.usedNonces.add(envelope.message.nonce);
    peer.authenticated = true;
    peer.deviceId = record.deviceId;
    record.lastSeenAt = Date.now();
    this.sendWs(peer.socket, {
      v: PROTOCOL_VERSION,
      requestId: envelope.requestId,
      sentAt: Date.now(),
      message: { type: "auth_result", ok: true }
    });
  }

  private async handleOffer(peer: PeerConnection, envelope: ControlEnvelope): Promise<void> {
    if (envelope.message.type !== "transfer_offer") {
      return;
    }
    if (this.transfers.has(envelope.message.transferId)) {
      throw new NexaError("TRANSFER_DUPLICATE", "Duplicate transfer ID");
    }
    const record: TransferRecord = {
      transferId: envelope.message.transferId,
      direction: "receive",
      peerDeviceId: peer.deviceId,
      peerDisplayName: this.paired.get(peer.deviceId)?.displayName ?? "Unknown",
      state: "created",
      files: envelope.message.files.map((f) => ({
        ...f,
        relativePath: sanitizeRelativePath(f.relativePath)
      })),
      totalBytes: envelope.message.totalBytes,
      bytesTransferred: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      destinationRoot: this.destinationRoot
    };
    const live: LiveTransfer = {
      record,
      sockets: new Set([peer.socket]),
      abort: new AbortController(),
      existingNames: new Set()
    };
    this.transfers.set(record.transferId, live);
    this.history.push(record);
    this.setState(live, "awaiting_approval");
    this.emit("incoming", record);
    this.emit("status", this.snapshot());
  }

  private async pushOutgoing(
    host: string,
    port: number,
    paired: PairedDeviceRecord,
    live: LiveTransfer,
    files: string[]
  ): Promise<void> {
    await this.withControlClient(host, port, paired.fingerprintSha256, async (ws) => {
      live.sockets.add(ws);
      this.sendWs(ws, {
        v: PROTOCOL_VERSION,
        requestId: randomUuid(),
        sentAt: Date.now(),
        message: {
          type: "auth_hello",
          deviceId: this.identity.deviceId,
          sessionToken: paired.sessionToken,
          nonce: randomToken(16)
        }
      });
      const auth = await waitFor(ws, "auth_result");
      if (auth.message.type !== "auth_result" || !auth.message.ok) {
        throw new NexaError("UNAUTHENTICATED", "Peer rejected authentication");
      }
      this.setState(live, "awaiting_approval");
      this.sendWs(ws, {
        v: PROTOCOL_VERSION,
        requestId: randomUuid(),
        sentAt: Date.now(),
        message: {
          type: "transfer_offer",
          transferId: live.record.transferId,
          files: live.record.files,
          totalBytes: live.record.totalBytes
        }
      });
      const decision = await waitFor(ws, "transfer_decision", 120_000);
      if (decision.message.type !== "transfer_decision" || !decision.message.accepted) {
        this.finish(live, "cancelled", "TRANSFER_REJECTED", "Remote declined");
        return;
      }
      this.setState(live, "accepted");
      this.setState(live, "connecting");
      this.setState(live, "transferring");
      let transferred = 0;
      for (const [index, filePath] of files.entries()) {
        const sha = await putFile({
          host,
          port,
          transferId: live.record.transferId,
          index,
          filePath,
          token: paired.sessionToken,
          fingerprint: paired.fingerprintSha256,
          signal: live.abort.signal,
          onProgress: (n) => {
            live.record.bytesTransferred = transferred + n;
            live.record.startedAt ??= Date.now();
            live.record.updatedAt = Date.now();
            this.emit("status", this.snapshot());
          }
        });
        const size = live.record.files[index]?.sizeBytes ?? 0;
        transferred += size;
        live.record.files[index]!.sha256Hex = sha;
      }
      this.setState(live, "verifying");
      this.setState(live, "completed");
      this.finish(live, "completed");
    });
  }

  private async withControlClient(
    host: string,
    port: number,
    expectedFingerprint: string,
    fn: (ws: WebSocket) => Promise<void>
  ): Promise<void> {
    requireFingerprint(expectedFingerprint);
    const url = `wss://${host}:${port}`;
    const ws = new WebSocket(url, {
      agent: pinnedHttpsAgent(expectedFingerprint),
      rejectUnauthorized: false
    });
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    try {
      await fn(ws);
    } finally {
      ws.close();
    }
  }

  private withProgress(record: TransferRecord): TransferRecord {
    const elapsedMs = Math.max(1, Date.now() - (record.startedAt ?? record.createdAt));
    const bytesPerSecond = record.bytesTransferred > 0 ? Math.round((record.bytesTransferred * 1000) / elapsedMs) : 0;
    const remaining = Math.max(0, record.totalBytes - record.bytesTransferred);
    const etaSeconds =
      bytesPerSecond > 0 && record.state === "transferring" ? Math.round(remaining / bytesPerSecond) : null;
    return { ...record, bytesPerSecond, etaSeconds };
  }

  private setState(live: LiveTransfer, next: TransferState): void {
    live.record.state = transition(live.record.state, next);
    live.record.updatedAt = Date.now();
    this.emit("status", this.snapshot());
  }

  private finish(
    live: LiveTransfer,
    state: TransferState,
    errorCode?: TransferRecord["errorCode"],
    errorMessage?: string
  ): void {
    if (!isTerminal(live.record.state) && live.record.state !== state) {
      try {
        live.record.state = transition(live.record.state, state);
      } catch {
        live.record.state = state;
      }
    } else {
      live.record.state = state;
    }
    live.record.errorCode = errorCode;
    live.record.errorMessage = errorMessage;
    live.record.updatedAt = Date.now();
    live.abort.abort();
    this.emit("status", this.snapshot());
    void this.persist();
  }

  private broadcast(live: LiveTransfer, envelope: ControlEnvelope): void {
    for (const socket of live.sockets) {
      this.sendWs(socket, envelope);
    }
  }

  private sendWs(socket: WebSocket, envelope: ControlEnvelope): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(envelope));
    }
  }

  private statePath(): string {
    return path.join(this.dataDir, "state.json");
  }

  private async persist(): Promise<void> {
    const state: PersistedState = {
      identity: this.identity,
      paired: [...this.paired.values()],
      history: this.history.slice(-500),
      destinationRoot: this.destinationRoot,
      clipboardSyncEnabled: this.clipboardSyncEnabled,
      onboardingComplete: this.onboardingComplete
    };
    await saveState(this.statePath(), state);
  }
}

const sessionNonce = new Map<string, string>();

function bearer(header?: string): string | undefined {
  if (!header?.startsWith("Bearer ")) {
    return undefined;
  }
  return header.slice("Bearer ".length);
}

function tlsFingerprint(socket: unknown): string | undefined {
  const tls = socket as { getPeerCertificate?: () => { raw?: Buffer } };
  const cert = tls.getPeerCertificate?.();
  if (!cert?.raw) {
    return undefined;
  }
  return createHash("sha256").update(cert.raw).digest("hex");
}

function waitFor(ws: WebSocket, type: string, timeoutMs = 15_000): Promise<ControlEnvelope> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new NexaError("TIMEOUT", `Timed out waiting for ${type}`)), timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      try {
        const envelope = parseControlEnvelope(data.toString());
        if (envelope.message.type === type || envelope.message.type === "transfer_error") {
          clearTimeout(timer);
          ws.off("message", onMessage);
          if (envelope.message.type === "transfer_error") {
            reject(new NexaError(envelope.message.errorCode, envelope.message.message));
            return;
          }
          resolve(envelope);
        }
      } catch (error) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        reject(error);
      }
    };
    ws.on("message", onMessage);
  });
}

async function putFile(options: {
  host: string;
  port: number;
  transferId: string;
  index: number;
  filePath: string;
  token: string;
  fingerprint: string;
  signal: AbortSignal;
  onProgress: (bytes: number) => void;
}): Promise<string> {
  requireFingerprint(options.fingerprint);
  const info = await stat(options.filePath);
  const hash = createHash("sha256");
  return await new Promise<string>((resolve, reject) => {
    const req = https.request(
      {
        host: options.host,
        port: options.port,
        path: `/v1/transfers/${options.transferId}/files/${options.index}`,
        method: "PUT",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Length": info.size,
          "Content-Type": "application/octet-stream"
        },
        rejectUnauthorized: false,
        agent: pinnedHttpsAgent(options.fingerprint)
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            ok: boolean;
            sha256Hex?: string;
            errorCode?: string;
            message?: string;
          };
          if (!body.ok || !body.sha256Hex) {
            reject(new NexaError((body.errorCode as never) ?? "NETWORK", body.message ?? "Upload failed"));
            return;
          }
          const localHash = hash.digest("hex");
          if (body.sha256Hex.toLowerCase() !== localHash) {
            reject(new NexaError("HASH_MISMATCH", "Sender and receiver SHA-256 do not match"));
            return;
          }
          resolve(body.sha256Hex);
        });
      }
    );
    req.on("error", reject);
    options.signal.addEventListener("abort", () => req.destroy(new Error("cancelled")));
    const stream = createReadStream(options.filePath);
    let sent = 0;
    stream.on("data", (chunk: string | Buffer) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      hash.update(buf);
      sent += buf.length;
      options.onProgress(sent);
    });
    stream.on("error", reject);
    stream.pipe(req);
  });
}

function lanIPv4(): string {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}

export { fingerprintFromCertPem };
