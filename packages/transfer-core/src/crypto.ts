import { createHash, createHmac, randomBytes, timingSafeEqual, X509Certificate } from "node:crypto";
import { createRequire } from "node:module";
import type { PeerIdentity } from "@nexashare/protocol";
import { NexaError, randomUuid } from "@nexashare/shared";

const require = createRequire(import.meta.url);
const selfsigned = require("selfsigned") as {
  generate: (
    attrs: Array<{ name: string; value: string }>,
    opts: { keySize?: number; algorithm?: string; days?: number }
  ) => { cert: string; private: string };
};

export interface DeviceIdentity {
  deviceId: string;
  displayName: string;
  certPem: string;
  keyPem: string;
  fingerprintSha256: string;
  publicKeySpkiHex: string;
}

export function sha256Buffer(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

export function fingerprintFromCertPem(certPem: string): string {
  const cert = new X509Certificate(certPem);
  return createHash("sha256").update(cert.raw).digest("hex");
}

export function createDeviceIdentity(displayName: string): DeviceIdentity {
  const deviceId = randomUuid();
  const generated = selfsigned.generate([{ name: "commonName", value: `nexashare-${deviceId}` }], {
    algorithm: "sha256",
    days: 825,
    keySize: 2048
  });
  const cert = new X509Certificate(generated.cert);
  const publicKeySpkiHex = cert.publicKey.export({ type: "spki", format: "der" }).toString("hex");
  return {
    deviceId,
    displayName,
    certPem: generated.cert,
    keyPem: generated.private,
    fingerprintSha256: fingerprintFromCertPem(generated.cert),
    publicKeySpkiHex
  };
}

export function toPeerIdentity(identity: DeviceIdentity): PeerIdentity {
  return {
    deviceId: identity.deviceId,
    displayName: identity.displayName,
    fingerprintSha256: identity.fingerprintSha256,
    publicKeySpkiHex: identity.publicKeySpkiHex
  };
}

export function pairingProof(
  code: string,
  sessionId: string,
  nonce: string,
  guestDeviceId: string,
  guestFingerprint: string
): string {
  return createHmac("sha256", `${code}:${sessionId}`)
    .update(`${nonce}:${guestDeviceId}:${guestFingerprint.toLowerCase()}`)
    .digest("hex");
}

export function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length === 0 || left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function tokensMatch(stored: string | undefined, presented: string | undefined): boolean {
  if (!stored || !presented) {
    return false;
  }
  return timingSafeEqualHex(hashSessionToken(stored), hashSessionToken(presented));
}

export function hashSessionToken(token: string): string {
  return sha256Buffer(token);
}

export function requireFingerprint(value: string | undefined | null): string {
  const fp = (value ?? "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fp)) {
    throw new NexaError("UNAUTHENTICATED", "Peer certificate fingerprint is required");
  }
  return fp;
}
