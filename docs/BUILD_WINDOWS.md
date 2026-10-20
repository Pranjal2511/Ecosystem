# Build on Windows

## Install tools

1. Node.js 20 LTS or 22 LTS from https://nodejs.org (Node 24 also worked while developing this repo).
2. Git for Windows.
3. Optional: Windows SDK if electron-builder asks for `signtool`. Unsigned local builds still produce an installer.

## Commands

```powershell
cd D:\nexashare
node -v
npm -v
npm install
npm test
npm run typecheck
npm run dev:desktop
```

Development uses `electron-vite`. The TLS engine starts with the window.

Production:

```powershell
npm run build:desktop
```

That runs `electron-vite build` then `electron-builder --win nsis`. Output, when successful, is under `apps/desktop/out/make`.

Do not commit signing certificates. To sign later, configure electron-builder `win.certificateFile` locally.

## Firewall

Do not turn Windows Firewall off. Create inbound allow rules for the NexaShare executable:

- TCP 19529 (or the port shown in Diagnostics)
- UDP 19528

If multicast is blocked, use manual IP pairing.

## Clean rebuild

```powershell
Remove-Item -Recurse -Force node_modules, packages\*\dist, apps\desktop\out -ErrorAction SilentlyContinue
npm install
npm test
```
