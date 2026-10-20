export const PROTOCOL_VERSION = 1;
export const PROTOCOL_MIN_VERSION = 1;
export const PROTOCOL_MAX_VERSION = 1;

export const DEFAULT_CONTROL_PORT = 19529;
export const DISCOVERY_PORT = 19528;
export const DISCOVERY_MULTICAST_IPV4 = "239.255.90.90";

export const MAX_DISCOVERY_PACKET_BYTES = 1024;
export const MAX_CONTROL_MESSAGE_BYTES = 64 * 1024;
export const MAX_TEXT_SHARE_BYTES = 32 * 1024;
export const MAX_DISPLAY_NAME_LENGTH = 64;
export const MAX_FILENAME_LENGTH = 180;
export const MAX_RELATIVE_PATH_LENGTH = 400;
export const MAX_FILES_PER_TRANSFER = 500;
export const MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024;
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_TTL_MS = 5 * 60 * 1000;
export const DISCOVERY_TTL_MS = 12_000;
export const CONTROL_TIMEOUT_MS = 30_000;
export const TRANSFER_IDLE_TIMEOUT_MS = 120_000;

export const CAPABILITIES = [
  "files",
  "folders",
  "text",
  "clipboard_opt_in",
  "sha256"
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type TransferState =
  | "created"
  | "awaiting_approval"
  | "accepted"
  | "connecting"
  | "transferring"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export const TRANSFER_STATES: readonly TransferState[] = [
  "created",
  "awaiting_approval",
  "accepted",
  "connecting",
  "transferring",
  "verifying",
  "completed",
  "failed",
  "cancelled",
  "interrupted"
] as const;

export type ErrorCode =
  | "PROTOCOL_UNSUPPORTED"
  | "MESSAGE_INVALID"
  | "MESSAGE_TOO_LARGE"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED"
  | "UNAUTHORIZED"
  | "PAIRING_EXPIRED"
  | "PAIRING_INVALID"
  | "PAIRING_CONSUMED"
  | "DEVICE_REVOKED"
  | "TRANSFER_NOT_FOUND"
  | "TRANSFER_STATE_INVALID"
  | "TRANSFER_REJECTED"
  | "TRANSFER_CANCELLED"
  | "TRANSFER_DUPLICATE"
  | "FILE_INVALID"
  | "PATH_REJECTED"
  | "SIZE_MISMATCH"
  | "HASH_MISMATCH"
  | "DISK_FULL"
  | "TIMEOUT"
  | "NETWORK"
  | "INTERNAL";

export interface FileOffer {
  index: number;
  relativePath: string;
  sizeBytes: number;
  sha256Hex?: string;
}

export interface DiscoveryAnnouncement {
  v: number;
  type: "announce";
  deviceId: string;
  displayName: string;
  port: number;
  capabilities: Capability[];
  protocolMin: number;
  protocolMax: number;
  fingerprintSha256: string;
}

export interface PairingQrPayload {
  v: number;
  deviceId: string;
  displayName: string;
  host: string;
  port: number;
  fingerprintSha256: string;
  pairingSessionId: string;
}

export type ControlMessage =
  | PairingHello
  | PairingChallenge
  | PairingProof
  | PairingResult
  | AuthHello
  | AuthResult
  | TransferOffer
  | TransferDecision
  | TransferProgress
  | TransferComplete
  | TransferCancel
  | TransferError
  | TextOffer
  | Heartbeat;

export interface ControlEnvelope {
  v: number;
  requestId: string;
  sentAt: number;
  message: ControlMessage;
}

interface BaseMessage {
  type: string;
}

export interface PairingHello extends BaseMessage {
  type: "pairing_hello";
  pairingSessionId: string;
  code: string;
  guest: PeerIdentity;
}

export interface PairingChallenge extends BaseMessage {
  type: "pairing_challenge";
  pairingSessionId: string;
  nonce: string;
}

export interface PairingProof extends BaseMessage {
  type: "pairing_proof";
  pairingSessionId: string;
  nonce: string;
  proofHex: string;
  guest: PeerIdentity;
}

export interface PairingResult extends BaseMessage {
  type: "pairing_result";
  ok: boolean;
  errorCode?: ErrorCode;
  host?: PeerIdentity;
  sessionToken?: string;
}

export interface AuthHello extends BaseMessage {
  type: "auth_hello";
  deviceId: string;
  sessionToken: string;
  nonce: string;
}

export interface AuthResult extends BaseMessage {
  type: "auth_result";
  ok: boolean;
  errorCode?: ErrorCode;
}

export interface TransferOffer extends BaseMessage {
  type: "transfer_offer";
  transferId: string;
  files: FileOffer[];
  totalBytes: number;
  note?: string;
}

export interface TransferDecision extends BaseMessage {
  type: "transfer_decision";
  transferId: string;
  accepted: boolean;
  reason?: string;
}

export interface TransferProgress extends BaseMessage {
  type: "transfer_progress";
  transferId: string;
  bytesTransferred: number;
  fileIndex: number;
}

export interface TransferComplete extends BaseMessage {
  type: "transfer_complete";
  transferId: string;
  fileIndex: number;
  sha256Hex: string;
  sizeBytes: number;
}

export interface TransferCancel extends BaseMessage {
  type: "transfer_cancel";
  transferId: string;
  reason?: string;
}

export interface TransferError extends BaseMessage {
  type: "transfer_error";
  transferId?: string;
  errorCode: ErrorCode;
  message: string;
}

export interface TextOffer extends BaseMessage {
  type: "text_offer";
  transferId: string;
  text: string;
}

export interface Heartbeat extends BaseMessage {
  type: "heartbeat";
}

export { PATH_FIXTURES, CONTROL_FIXTURE_TRANSFER_OFFER } from "./fixtures.js";

export interface PeerIdentity {
  deviceId: string;
  displayName: string;
  fingerprintSha256: string;
  publicKeySpkiHex: string;
}

export interface PairedDeviceRecord {
  deviceId: string;
  displayName: string;
  fingerprintSha256: string;
  publicKeySpkiHex: string;
  sessionToken: string;
  pairedAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

export interface TransferRecord {
  transferId: string;
  direction: "send" | "receive";
  peerDeviceId: string;
  peerDisplayName: string;
  state: TransferState;
  files: FileOffer[];
  totalBytes: number;
  bytesTransferred: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  bytesPerSecond?: number;
  etaSeconds?: number | null;
  errorCode?: ErrorCode;
  errorMessage?: string;
  destinationRoot?: string;
}

export * from "./fixtures.js";
