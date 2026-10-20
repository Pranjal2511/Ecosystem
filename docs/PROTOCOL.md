# NexaShare protocol v1

## Transports

| Channel | Protocol | Purpose |
| --- | --- | --- |
| Discovery | UDP multicast `239.255.90.90:19528` | Untrusted presence |
| Control | WebSocket over TLS (`wss`) default TCP `19529` | Pairing, auth, offers, decisions, errors |
| Payload | HTTPS `PUT /v1/transfers/{transferId}/files/{index}` | File bytes |

Plain HTTP is not used for file bytes. `rejectUnauthorized` is false only so self-signed certificates can be used; **peer identity is the SHA-256 fingerprint of the certificate DER**, compared to the value exchanged at pairing/QR time.

## Versioning

Every JSON object includes `"v": 1`. Peers advertise `protocolMin` / `protocolMax` in discovery. Incompatible ranges produce `PROTOCOL_UNSUPPORTED`.

## Discovery announcement

```json
{
  "v": 1,
  "type": "announce",
  "deviceId": "uuid",
  "displayName": "Office PC",
  "port": 19529,
  "capabilities": ["files", "folders", "text", "clipboard_opt_in", "sha256"],
  "protocolMin": 1,
  "protocolMax": 1,
  "fingerprintSha256": "hex64"
}
```

Limits: 1024 bytes, rate-limited per source IP, malformed packets dropped. Discovery is never authentication.

## Control envelope

```json
{
  "v": 1,
  "requestId": "uuid",
  "sentAt": 1710000000000,
  "message": { "type": "..." }
}
```

Maximum 64 KiB. Validated with Zod on Node and equivalent checks on Android.

### Pairing

1. Host creates a pairing session: UUID + 6-digit code, TTL 5 minutes, single successful use.
2. Guest sends `pairing_hello` with session id, code, and guest identity.
3. Host replies `pairing_challenge` with a random nonce.
4. Guest sends `pairing_proof` = HMAC-SHA256(key=`code:sessionId`, data=nonce).
5. Host verifies, consumes the session, stores a 32-byte session token, replies `pairing_result`.

Wrong codes, expired sessions, reused nonces, and consumed sessions fail.

### Authentication

Paired clients send `auth_hello` `{ deviceId, sessionToken, nonce }`. Nonces are remembered to block replay. Revoked devices receive `DEVICE_REVOKED`.

### Transfer

- `transfer_offer` — file list with sanitized relative paths and sizes.
- `transfer_decision` — accept/reject. Default is reject until the user accepts.
- `transfer_progress` / `transfer_cancel` / `transfer_error`.
- File PUT requires `Authorization: Bearer <sessionToken>` and `Content-Length`.
- Receiver hashes bytes as they arrive. Declared size must match. Optional per-file `sha256Hex` on the offer is also checked.

## Transfer states

`created → awaiting_approval → accepted → connecting → transferring → verifying → completed`

Failures, cancel, and interrupt are explicit. Invalid transitions throw `TRANSFER_STATE_INVALID`.

## Limits

- 500 files per transfer
- 50 GiB declared max per file (still streamed; disk may fail earlier)
- 32 KiB max text share
- Pairing: 8 attempts then lock

## Not in v1

- Byte-range resume
- Mutual TLS client certificates (session token instead)
- Automatic clipboard push
