# Troubleshooting

## Devices do not appear

- Same SSID? Guest Wi-Fi often isolates clients.
- VPN kill-switch or full-tunnel VPN can hide LAN multicast.
- Windows Firewall may drop UDP 19528.
- Hotspot: the phone and PC roles differ; the client list may not route multicast. Use manual IP.

## Pairing fails

- Code expires in five minutes and is one-time.
- Fingerprint must match the host certificate (Security screen).
- Wrong IP/port if the host rebound after a crash (check Diagnostics).

## Transfer starts then fails

- Receiver must click Accept.
- Disk full → `DISK_FULL` / native ENOSPC.
- Hash mismatch → file changed during send or a middlebox altered bytes (unlikely on TLS).
- Unpaired or revoked peer → pair again.

## Windows app does not launch

- Run `npm install` at the repo root, not only in `apps/desktop`.
- Delete `apps/desktop/out` and rerun `npm run dev:desktop`.

## Android native module missing

JS-only Metro sessions without the compiled APK show “Native module missing”. That is expected until `run-android` succeeds.
