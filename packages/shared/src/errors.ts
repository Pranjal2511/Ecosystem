import type { ErrorCode } from "@nexashare/protocol";

export class NexaError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "NexaError";
    this.code = code;
  }
}

export const ERROR_GUIDANCE: Record<ErrorCode, string> = {
  PROTOCOL_UNSUPPORTED:
    "This device speaks a newer or older NexaShare protocol. Update both apps to the same version.",
  MESSAGE_INVALID: "The other device sent a malformed message. Ignore it and try pairing again.",
  MESSAGE_TOO_LARGE: "A control message exceeded the size limit and was rejected.",
  RATE_LIMITED: "Too many requests from this peer. Wait a moment and retry.",
  UNAUTHENTICATED: "This connection is not authenticated. Pair the devices first.",
  UNAUTHORIZED: "This device is not allowed to perform that action. Revoke and re-pair if needed.",
  PAIRING_EXPIRED: "The pairing code expired. Generate a new code or QR code.",
  PAIRING_INVALID: "The pairing code or QR payload did not match. Check both screens and retry.",
  PAIRING_CONSUMED: "That pairing session was already used. Start a new pairing session.",
  DEVICE_REVOKED: "Trust for this device was revoked. Pair again to restore transfers.",
  TRANSFER_NOT_FOUND: "The transfer is no longer active. Retry sending the files.",
  TRANSFER_STATE_INVALID: "The transfer cannot move to that state. Cancel and start a new transfer.",
  TRANSFER_REJECTED: "The other device declined this transfer.",
  TRANSFER_CANCELLED: "The transfer was cancelled.",
  TRANSFER_DUPLICATE: "A transfer with this ID already exists.",
  FILE_INVALID: "A file entry was rejected. Check names, sizes, and paths.",
  PATH_REJECTED: "A filename or relative path was unsafe and was blocked.",
  SIZE_MISMATCH: "The number of bytes received did not match the declared size.",
  HASH_MISMATCH: "SHA-256 verification failed. The file may be corrupt or tampered with.",
  DISK_FULL: "There is not enough free space at the destination.",
  TIMEOUT: "The operation timed out. Check Wi-Fi, VPN, and firewall settings.",
  NETWORK: "A network error interrupted the connection. See TROUBLESHOOTING.md.",
  INTERNAL: "An unexpected local error occurred. Check application logs."
};
