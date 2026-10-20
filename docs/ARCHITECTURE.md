# Architecture

## Goals

NexaShare keeps all transfer traffic on the local network. Windows uses an Electron main process as a privileged host for filesystem and TLS. Android uses a Kotlin module for TLS, file descriptors, and foreground-service lifetime. Shared TypeScript packages define the protocol and safety rules.

## Process model

```
Windows renderer (sandboxed React)
        | IPC (validated)
Windows main (NexaEngine)
        | TLS 1.2+ / WSS / HTTPS PUT
Android JS (React Native)
        | Native module
AndroidEngine.kt (OkHttp client + TlsProtocolServer inbound listener + bounded-memory receiveFile)
```

The renderer never receives raw filesystem or socket handles. Preload exposes a narrow `window.nexa` API.

## Packages

- `@nexashare/protocol` — version constants, message shapes, transfer states, error codes.
- `@nexashare/shared` — `NexaError`, UUID/code helpers, path sanitizer, rate limiter, state machine.
- `@nexashare/validation` — Zod schemas and size-limited JSON parsers.
- `@nexashare/transfer-core` — Node implementation used by Electron: identity, discovery, pairing, HTTPS streaming, persistence.

Android lifecycle: STOPPED → STARTING → LISTENING (TLS server active) → STOPPING → STOPPED. The engine manages identity, pairing sessions, incoming approvals (`decide()`), bounded-memory file receiving (`receiveFile()`), and control-message routing (`onControl()`). Foreground service provides notification lifetime.

## Data flow for a send

1. Sender must already be paired with the receiver (session token + pinned fingerprint).
2. Sender opens `wss://host:port` and sends `auth_hello`.
3. Sender sends `transfer_offer`.
4. Receiver UI must accept (`transfer_decision`).
5. Sender streams each file with `PUT /v1/transfers/:id/files/:index`.
6. Receiver writes a temp file, hashes SHA-256 on the fly, checks size, then renames into the destination root with collision-safe names.
7. Transfer is `completed` only after verification.

## Persistence

Windows stores `state.json` under Electron `userData/nexashare`. It contains the device TLS key, paired peers, destination folder, and history. Treat this directory as sensitive. Android should move secrets into Keystore-backed storage before a production release; the current Kotlin MVP still holds the session token in memory.

## Why not a `services/` folder

npm workspaces resolve first-level packages cleanly. The transfer engine is therefore `packages/transfer-core` rather than `services/transfer-core`.
