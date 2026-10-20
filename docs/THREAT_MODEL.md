# Threat model

## Assets

- User files in flight and at rest in the download folder
- Device TLS private key
- Session tokens
- Pairing codes
- Transfer history (filenames)

## Adversaries

1. Another client on the same Wi-Fi
2. A spoofed discovery advertiser
3. A malicious sender after pairing
4. A local process reading NexaShare state
5. Accidental user error (wrong device, huge files)

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Spoofed discovery | Discovery is untrusted; pairing pins fingerprint |
| Pairing-code guessing | 6 digits + 5 minute TTL + 8 attempts + rate limit + nonce |
| Replay of pairing proof | Nonce stored in `usedNonces` |
| Unauthenticated upload | PUT requires session token bound to an accepted transfer |
| Path traversal | `sanitizeRelativePath` + root prefix check |
| Hash substitution | SHA-256 of actual bytes; size must match |
| Duplicate transfer IDs | Rejected |
| Resource exhaustion | Message size caps, file count caps, rate limits |
| Interrupted writes | Temp directory; incomplete files are not finalized |
| Revoked peer | `revoked` flag blocks auth |
| Clipboard leak | Sync off by default; no automatic clipboard send in v0.1 |

## Residual risk

- UDP multicast can leak device display names on the LAN. Users should pick non-identifying names if that matters.
- A paired malicious device can offer files; the user must still approve, but social engineering remains possible.
- `state.json` on disk is readable by other software running as the same Windows user.
- Android inbound TLS server (`TlsProtocolServer`) is implemented and connected to `AndroidEngine`; full receiving verification requires device testing.
- A paired malicious device can offer files; user approval (`decide()`) is required before `receiveFile()` writes any data.
