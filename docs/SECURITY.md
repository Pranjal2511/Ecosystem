# Security

## Trust model

Same Wi-Fi is hostile. NexaShare does not treat LAN membership as identity.

Trust is established only by an explicit pairing ceremony that:

1. Pins the receiver TLS certificate fingerprint.
2. Proves knowledge of a short-lived pairing code with a one-time nonce.
3. Issues a session token stored with the paired device record.

## Encryption

File bytes and control messages use TLS. This is **transport encryption with certificate pinning**, not a separate application-layer E2E box. The Electron main process and the Android native module can see plaintext, which is required to write files.

On Android, the TLS client uses a custom `TrustManager` that verifies the server certificate fingerprint against the value pinned during pairing. The `hostnameVerifier` is overridden because peer identity is established by fingerprint (self-signed certificates with `nexashare-<deviceId>` CN), not by hostname. The fingerprint comparison fails closed: any mismatch or empty fingerprint is rejected.

Do not claim “end-to-end encryption” in marketing copy for this version.

## Electron hardening

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- CSP: `default-src 'self'`
- Preload exposes only `window.nexa`
- IPC arguments are type-checked
- External links open via `shell.openExternal` for http(s) only
- Navigation away from the app is blocked

## Filesystem

Incoming names pass `sanitizeRelativePath`. Absolute paths, `..`, reserved Windows names, and control characters are rejected. The resolved destination must stay inside the user-selected root. Files are created as `wx` temp parts, then renamed. Existing files are never overwritten; a ` (n)` suffix is added.

Received files are never executed or auto-opened.

## Secrets

- No shared private keys in the repo
- Per-device cert/key generated at first run
- Pairing codes expire and are one-time
- Session tokens are random 32-byte values
- `.gitignore` excludes keystores, pem files, and `userData`

**Limitation:** Windows persistence currently writes `state.json` (including the TLS private key and session tokens) under userData with mode `0600` on POSIX. On Windows ACLs follow the user profile. DPAPI wrapping is a planned hardening step. Android currently keeps the session token in memory; Keystore persistence is required before production.

## What this app will not do

No remote shell, no screen capture, no silent filesystem crawl, no telemetry by default, no ads.
