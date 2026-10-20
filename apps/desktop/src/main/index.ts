import { app, BrowserWindow, dialog, ipcMain, Notification, shell, Tray, Menu, nativeImage } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NexaEngine } from "@nexashare/transfer-core";
import { parsePairingQr } from "@nexashare/validation";
import { NexaError } from "@nexashare/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let engine: NexaEngine | null = null;

function dataDir(): string {
  return path.join(app.getPath("userData"), "nexashare");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    title: "NexaShare",
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function emitStatus(): void {
  if (engine && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("nexa:status", engine.snapshot());
  }
}

async function ensureEngine(): Promise<NexaEngine> {
  if (engine) {
    return engine;
  }
  const name = os.hostname().slice(0, 64) || "Windows PC";
  engine = new NexaEngine({
    dataDir: dataDir(),
    displayName: name,
    destinationRoot: path.join(app.getPath("downloads"), "NexaShare")
  });
  engine.on("status", () => emitStatus());
  engine.on("incoming", (record: { transferId: string; peerDisplayName: string; files: unknown[] }) => {
    emitStatus();
    if (Notification.isSupported()) {
      new Notification({
        title: "Incoming transfer",
        body: `${record.peerDisplayName} wants to send ${record.files.length} file(s)`
      }).show();
    }
  });
  await engine.start();
  return engine;
}

function ipcError(error: unknown): { ok: false; error: string; code?: string } {
  if (error instanceof NexaError) {
    return { ok: false, error: error.message, code: error.code };
  }
  return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
}

app.whenReady().then(async () => {
  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      const allowed = process.env.ELECTRON_RENDERER_URL;
      if (allowed && url.startsWith(allowed)) {
        return;
      }
      if (url.startsWith("file:")) {
        return;
      }
      event.preventDefault();
    });
  });

  registerIpc();
  createWindow();
  await ensureEngine();
  emitStatus();

  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("NexaShare");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open NexaShare", click: () => mainWindow?.show() },
      { type: "separator" },
      { label: "Quit", click: () => app.quit() }
    ])
  );
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  void engine?.stop();
});

function registerIpc(): void {
  ipcMain.handle("nexa:snapshot", async () => {
    const current = await ensureEngine();
    return { ok: true, snapshot: current.snapshot() };
  });

  ipcMain.handle("nexa:complete-onboarding", async () => {
    const current = await ensureEngine();
    current.completeOnboarding();
    return { ok: true };
  });

  ipcMain.handle("nexa:set-name", async (_e, name: unknown) => {
    if (typeof name !== "string" || name.trim().length < 1 || name.length > 64) {
      return { ok: false, error: "Invalid display name" };
    }
    const current = await ensureEngine();
    current.setDisplayName(name.trim());
    return { ok: true };
  });

  ipcMain.handle("nexa:create-pairing", async () => {
    const current = await ensureEngine();
    return { ok: true, pairing: current.createPairingSession() };
  });

  ipcMain.handle("nexa:pair-guest", async (_e, payload: unknown) => {
    try {
      const body = payload as {
        host: string;
        port: number;
        pairingSessionId: string;
        code: string;
        expectedFingerprint: string;
      };
      if (!body.host || !body.port || !body.code) {
        return { ok: false, error: "Missing pairing fields" };
      }
      const current = await ensureEngine();
      await current.pairAsGuest(body);
      return { ok: true };
    } catch (error) {
      return ipcError(error);
    }
  });

  ipcMain.handle("nexa:pair-qr", async (_e, raw: unknown) => {
    try {
      if (typeof raw !== "string") {
        return { ok: false, error: "QR payload must be text" };
      }
      const qr = parsePairingQr(raw);
      return { ok: true, qr };
    } catch (error) {
      return ipcError(error);
    }
  });

  ipcMain.handle("nexa:pick-files", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "Choose files to send"
    });
    return { ok: true, canceled: result.canceled, files: result.filePaths };
  });

  ipcMain.handle("nexa:pick-folder-destination", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: "Choose download folder"
    });
    if (result.canceled || !result.filePaths[0]) {
      return { ok: true, canceled: true };
    }
    const current = await ensureEngine();
    current.setDestinationRoot(result.filePaths[0]);
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle("nexa:send-files", async (_e, payload: unknown) => {
    try {
      const body = payload as { host: string; port: number; deviceId: string; files: string[] };
      if (!body.host || !body.port || !body.deviceId || !Array.isArray(body.files)) {
        return { ok: false, error: "Invalid send payload" };
      }
      for (const file of body.files) {
        if (typeof file !== "string" || file.includes("\0") || !fs.existsSync(file)) {
          return { ok: false, error: "Invalid file path" };
        }
      }
      const current = await ensureEngine();
      const transferId = await current.sendFiles(body, body.files);
      return { ok: true, transferId };
    } catch (error) {
      return ipcError(error);
    }
  });

  ipcMain.handle("nexa:decide", async (_e, payload: unknown) => {
    try {
      const body = payload as { transferId: string; accepted: boolean };
      const current = await ensureEngine();
      await current.decideIncoming(body.transferId, body.accepted);
      return { ok: true };
    } catch (error) {
      return ipcError(error);
    }
  });

  ipcMain.handle("nexa:revoke", async (_e, deviceId: unknown) => {
    if (typeof deviceId !== "string") {
      return { ok: false, error: "Invalid device id" };
    }
    const current = await ensureEngine();
    current.revokeDevice(deviceId);
    return { ok: true };
  });

  ipcMain.handle("nexa:unpair", async (_e, deviceId: unknown) => {
    if (typeof deviceId !== "string") {
      return { ok: false, error: "Invalid device id" };
    }
    const current = await ensureEngine();
    current.unpairDevice(deviceId);
    return { ok: true };
  });

  ipcMain.handle("nexa:clear-history", async () => {
    const current = await ensureEngine();
    current.clearHistory();
    return { ok: true };
  });

  ipcMain.handle("nexa:clipboard-sync", async (_e, enabled: unknown) => {
    if (typeof enabled !== "boolean") {
      return { ok: false, error: "Invalid flag" };
    }
    const current = await ensureEngine();
    current.setClipboardSyncEnabled(enabled);
    return { ok: true };
  });

  ipcMain.handle("nexa:open-destination", async () => {
    const current = await ensureEngine();
    await shell.openPath(current.destinationRoot);
    return { ok: true };
  });

  ipcMain.handle("nexa:diagnostics", async () => {
    const current = await ensureEngine();
    return {
      ok: true,
      diagnostics: {
        platform: process.platform,
        arch: process.arch,
        hostname: os.hostname(),
        interfaces: Object.entries(os.networkInterfaces()).map(([name, addrs]) => ({
          name,
          addresses: (addrs ?? []).map((a) => ({ address: a.address, family: a.family, internal: a.internal }))
        })),
        port: current.listenPort,
        destinationRoot: current.destinationRoot,
        userData: app.getPath("userData")
      }
    };
  });
}
