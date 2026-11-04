# NexaShare

Local-first file transfer between desktop and mobile devices over LAN, with
pairing, SHA-256 verification, and end-to-end TLS pinning.

## Packages

| Package | Purpose |
|---------|---------|
| `@nexashare/protocol` | Protocol constants, message types, error codes |
| `@nexashare/shared` | Shared helpers: errors, paths, fingerprints, IDs, rate limiting, state machine |
| `@nexashare/validation` | Zod schemas for discovery/control messages |
| `@nexashare/transfer-core` | `NexaEngine`: pairing, discovery, transfers, persistence |

## Scripts (run from repo root)

```
npm install          # install dependencies and link workspace packages
npm run build        # build all packages (via workspace build scripts)
npm test             # run vitest (7 files, 24 tests)
```

## Security

- Pairing uses a 6-digit code + HMAC proof over nonce
- TLS certificate fingerprint pinning on every connection
- Session tokens are SHA-256 hashed before comparison (timing-safe)
- Path traversal and Windows reserved names are rejected

## Status

The desktop (`@nexashare/desktop`) and mobile (`@nexashare/android`) app
source directories are empty placeholders. Only the shared library packages
are implemented.
