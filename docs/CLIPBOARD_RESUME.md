# Clipboard Synchronization

Status: **Unavailable (deferred)**

The desktop settings screen shows an opt-in toggle (`clipboardSyncEnabled`), but end-to-end clipboard transmission is not implemented in v1.

Requirements before enabling:

- Explicit opt-in on both devices.
- Peer authentication via session token.
- Size limit (32 KiB max per text share, per protocol).
- No automatic transmission when disabled.
- Android background clipboard restrictions respected.

Because the feature is not implemented, no data is transmitted automatically. The flag exists only for future integration.

---

# Resumable Transfers

Status: **Not implemented**

Failed transfers can be retried as a new transfer. There is no byte-range resume, partial-transfer metadata persistence, or offset validation.

Requirements for future resume support (documented, not implemented):

- Persist partial-transfer metadata (transfer ID, source file identity, chunk boundaries).
- Validate offsets and file identity on restart.
- Revalidate partial contents against SHA-256.
- Handle changed source files and clean up abandoned transfers.

Do not claim resumable transfer support until fully implemented and tested.
