import {
  CAPABILITIES,
  MAX_CONTROL_MESSAGE_BYTES,
  MAX_DISCOVERY_PACKET_BYTES,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_FILE_BYTES,
  MAX_FILES_PER_TRANSFER,
  MAX_TEXT_SHARE_BYTES,
  PAIRING_CODE_LENGTH,
  PROTOCOL_MAX_VERSION,
  PROTOCOL_MIN_VERSION,
  type Capability,
  type ControlEnvelope,
  type DiscoveryAnnouncement,
  type PairingQrPayload
} from "@nexashare/protocol";
import { NexaError } from "@nexashare/shared";
import { z } from "zod";

const hex64 = z.string().regex(/^[a-f0-9]{64}$/i);
const uuid = z.string().uuid();
const deviceName = z.string().trim().min(1).max(MAX_DISPLAY_NAME_LENGTH);
const capability = z.enum(CAPABILITIES as unknown as [Capability, ...Capability[]]);

export const discoveryAnnouncementSchema = z.object({
  v: z.number().int().min(PROTOCOL_MIN_VERSION).max(PROTOCOL_MAX_VERSION),
  type: z.literal("announce"),
  deviceId: uuid,
  displayName: deviceName,
  port: z.number().int().min(1).max(65535),
  capabilities: z.array(capability).min(1).max(16),
  protocolMin: z.number().int(),
  protocolMax: z.number().int(),
  fingerprintSha256: hex64
});

export const pairingQrSchema = z.object({
  v: z.number().int().min(PROTOCOL_MIN_VERSION).max(PROTOCOL_MAX_VERSION),
  deviceId: uuid,
  displayName: deviceName,
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  fingerprintSha256: hex64,
  pairingSessionId: uuid
});

const peerIdentitySchema = z.object({
  deviceId: uuid,
  displayName: deviceName,
  fingerprintSha256: hex64,
  publicKeySpkiHex: z.string().regex(/^[a-f0-9]{64,4096}$/i)
});

const fileOfferSchema = z.object({
  index: z.number().int().min(0).max(MAX_FILES_PER_TRANSFER - 1),
  relativePath: z.string().min(1).max(400),
  sizeBytes: z.number().int().min(0).max(MAX_FILE_BYTES),
  sha256Hex: hex64.optional()
});

export const controlEnvelopeSchema = z.object({
  v: z.number().int().min(PROTOCOL_MIN_VERSION).max(PROTOCOL_MAX_VERSION),
  requestId: uuid,
  sentAt: z.number().int().positive(),
  message: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("pairing_hello"),
      pairingSessionId: uuid,
      code: z.string().length(PAIRING_CODE_LENGTH).regex(/^\d+$/),
      guest: peerIdentitySchema
    }),
    z.object({
      type: z.literal("pairing_challenge"),
      pairingSessionId: uuid,
      nonce: z.string().min(16).max(128)
    }),
    z.object({
      type: z.literal("pairing_proof"),
      pairingSessionId: uuid,
      nonce: z.string().min(16).max(128),
      proofHex: hex64,
      guest: peerIdentitySchema
    }),
    z.object({
      type: z.literal("pairing_result"),
      ok: z.boolean(),
      errorCode: z.string().optional(),
      host: peerIdentitySchema.optional(),
      sessionToken: z.string().min(16).max(256).optional()
    }),
    z.object({
      type: z.literal("auth_hello"),
      deviceId: uuid,
      sessionToken: z.string().min(16).max(256),
      nonce: z.string().min(16).max(128)
    }),
    z.object({
      type: z.literal("auth_result"),
      ok: z.boolean(),
      errorCode: z.string().optional()
    }),
    z.object({
      type: z.literal("transfer_offer"),
      transferId: uuid,
      files: z.array(fileOfferSchema).min(1).max(MAX_FILES_PER_TRANSFER),
      totalBytes: z.number().int().min(0).max(MAX_FILE_BYTES * MAX_FILES_PER_TRANSFER),
      note: z.string().max(200).optional()
    }),
    z.object({
      type: z.literal("transfer_decision"),
      transferId: uuid,
      accepted: z.boolean(),
      reason: z.string().max(200).optional()
    }),
    z.object({
      type: z.literal("transfer_progress"),
      transferId: uuid,
      bytesTransferred: z.number().int().min(0),
      fileIndex: z.number().int().min(0)
    }),
    z.object({
      type: z.literal("transfer_complete"),
      transferId: uuid,
      fileIndex: z.number().int().min(0),
      sha256Hex: hex64,
      sizeBytes: z.number().int().min(0)
    }),
    z.object({
      type: z.literal("transfer_cancel"),
      transferId: uuid,
      reason: z.string().max(200).optional()
    }),
    z.object({
      type: z.literal("transfer_error"),
      transferId: uuid.optional(),
      errorCode: z.string(),
      message: z.string().max(500)
    }),
    z.object({
      type: z.literal("text_offer"),
      transferId: uuid,
      text: z.string().max(MAX_TEXT_SHARE_BYTES)
    }),
    z.object({
      type: z.literal("heartbeat")
    })
  ])
});

function utf8ByteLength(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

export function parseJsonSizeLimited(raw: string, maxBytes: number): unknown {
  const bytes = utf8ByteLength(raw);
  if (bytes > maxBytes) {
    throw new NexaError("MESSAGE_TOO_LARGE", `Message is ${bytes} bytes`);
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new NexaError("MESSAGE_INVALID", "JSON parse failed");
  }
}

export function parseDiscoveryPacket(raw: string): DiscoveryAnnouncement {
  const data = parseJsonSizeLimited(raw, MAX_DISCOVERY_PACKET_BYTES);
  const parsed = discoveryAnnouncementSchema.safeParse(data);
  if (!parsed.success) {
    throw new NexaError("MESSAGE_INVALID", "Invalid discovery announcement");
  }
  if (parsed.data.protocolMax < PROTOCOL_MIN_VERSION || parsed.data.protocolMin > PROTOCOL_MAX_VERSION) {
    throw new NexaError("PROTOCOL_UNSUPPORTED", "Incompatible protocol version");
  }
  return parsed.data;
}

export function parseControlEnvelope(raw: string): ControlEnvelope {
  const data = parseJsonSizeLimited(raw, MAX_CONTROL_MESSAGE_BYTES);
  const parsed = controlEnvelopeSchema.safeParse(data);
  if (!parsed.success) {
    throw new NexaError("MESSAGE_INVALID", "Invalid control message");
  }
  return parsed.data as ControlEnvelope;
}

export function parsePairingQr(raw: string): PairingQrPayload {
  const data = parseJsonSizeLimited(raw, 4096);
  const parsed = pairingQrSchema.safeParse(data);
  if (!parsed.success) {
    throw new NexaError("MESSAGE_INVALID", "Invalid pairing QR payload");
  }
  return parsed.data;
}

export function assertProtocolVersion(v: number): void {
  if (v < PROTOCOL_MIN_VERSION || v > PROTOCOL_MAX_VERSION) {
    throw new NexaError("PROTOCOL_UNSUPPORTED", `Protocol ${v} is not supported`);
  }
}
