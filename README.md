# NexaShare

NexaShare is a local-first file sharing application for Windows 11 and Android. Devices on the same Wi-Fi (or compatible hotspot) can pair explicitly, then send files over TLS with SHA-256 verification. There is no account, cloud backend, or internet requirement for ordinary transfers.

## Current status

| Area | Status |
| --- | --- |
| Shared protocol, validation, path safety, transfer state machine | Implemented and unit-tested |
| Node transfer engine (TLS, pairing, streaming, approval, SHA-256) | Implemented; loopback integration tests |
| Windows desktop (Electron + React) | Implemented; launch verified in this environment when `npm run dev:desktop` succeeds |
| Android React Native app + Kotlin native module | Source present; **APK not built here** because JDK is not installed |
| UDP multicast discovery | Implemented in the Node engine |
| Bidirectional Windows↔Android on physical hardware | **Unverified** until JDK + a Realme (or other) phone are available |
| Resumable transfers | Not implemented. Failed transfers can be retried as a new transfer |
| Clipboard sync | Opt-in flag exists; contents are not transmitted until a later milestone |

## Requirements

- Windows 11
- Node.js 20.11 or newer (this machine used Node 24.21.0)
- npm 10+ (this machine used npm 11.19.0)
- Git
- For Android builds: JDK 17, Android SDK, and Android Studio. **Java was not installed in the environment that created this repository.**

## Quick start (Windows)

```powershell
cd D:\nexashare
npm install
npm test
npm run typecheck
npm run dev:desktop
```

Expected:

- `npm test` runs Vitest over unit, security, and loopback integration tests.
- `npm run dev:desktop` opens the Electron app. The main process starts a TLS listener and UDP discovery.

## Workspace layout

```
apps/desktop     Electron + React + Vite (electron-vite + electron-builder)
apps/android     React Native + Kotlin native module
packages/protocol
packages/shared
packages/validation
packages/transfer-core   Node TLS/WebSocket/HTTP streaming engine
tests/unit|integration|security
docs/
```

`services/transfer-core` from the original sketch lives at `packages/transfer-core` so npm workspaces can resolve it as `@nexashare/transfer-core`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm install` | Install workspace dependencies |
| `npm test` | Unit, security, and integration tests |
| `npm run test:unit` | Unit tests only |
| `npm run test:security` | Pairing and unauthenticated-upload tests |
| `npm run test:integration` | Two local engine instances |
| `npm run typecheck` | TypeScript across workspaces that define it |
| `npm run lint` | ESLint across workspaces that define it |
| `npm run dev:desktop` | Electron development |
| `npm run build:desktop` | Windows installer via electron-builder (NSIS) |
| `npm run android` | `react-native run-android` (needs JDK + SDK) |

## Security in one paragraph

Each device generates its own TLS certificate. Discovery advertisements are untrusted. Pairing uses a short-lived 6-digit code, a one-time nonce, and an HMAC proof. After pairing, the client pins the server certificate fingerprint and authenticates with a session token. Incoming files require user approval. Relative paths are sanitized; writes stay inside the chosen download folder. Incomplete files live under `.nexashare-tmp` until size and hash checks succeed.

Read `docs/PROTOCOL.md`, `docs/SECURITY.md`, and `docs/THREAT_MODEL.md` before shipping a release.
"# Ecosystem" 
