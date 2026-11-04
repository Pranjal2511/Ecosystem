import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "node:path";
import { createServer } from "node:http";
import { NexaEngine, WindowsHelloUnlockProvider } from "@nexashare/transfer-core";
import { mkdir } from "node:fs/promises";
import os from "node:os";

let mainWindow: BrowserWindow | null = null;
let engine: NexaEngine | null = null;
let httpServer: ReturnType<typeof createServer> | null = null;

const HTTP_PORT = 19529;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    },
    title: "NexaShare"
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/desktop/renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function initEngine(): Promise<void> {
  const dataDir = path.join(os.homedir(), ".nexashare", "desktop");
  await mkdir(dataDir, { recursive: true });

  engine = new NexaEngine({
    dataDir,
    displayName: "NexaShare Desktop",
    enableDiscovery: true,
    unlockProvider: new WindowsHelloUnlockProvider()
  });

  engine.on("status", (snapshot: unknown) => {
    mainWindow?.webContents.send("status:snapshot", snapshot);
    broadcastHttpEvent("status:snapshot", snapshot);
  });

  engine.on("devices", (devices: unknown) => {
    mainWindow?.webContents.send("devices:update", devices);
    broadcastHttpEvent("devices:update", devices);
  });

  engine.on("incoming", (record: unknown) => {
    mainWindow?.webContents.send("transfer:incoming", record);
    broadcastHttpEvent("transfer:incoming", record);
  });

  await engine.start();
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function broadcastHttpEvent(event: string, data: unknown): void {
  // HTTP clients (mobile) poll for updates; events are broadcast via snapshot
}

function startHttpServer(): void {
  if (!engine) return;

  httpServer = createServer((req, res) => {
    const url = new URL(req.url || "", `http://localhost:${HTTP_PORT}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const handleError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    };

    const sendJson = (data: unknown, statusCode = 200): void => {
      res.writeHead(statusCode, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };

    async function handleRequest(): Promise<void> {
      try {
        if (pathname === "/v1/snapshot" && method === "GET") {
          sendJson(engine!.snapshot());
        } else if (pathname === "/v1/pairing/create" && method === "POST") {
          const result = await engine!.createPairingSession();
          sendJson({ pairingSessionId: result.qr.pairingSessionId, code: result.code, expiresAt: result.expiresAt });
        } else if (pathname === "/v1/unlock" && method === "POST") {
          await engine!.unlockLaptop();
          sendJson({ ok: true });
        } else if (pathname === "/v1/stop" && method === "POST") {
          await engine!.stop();
          engine = null;
          sendJson({ ok: true });
        } else if (pathname === "/v1/transfers/send" && method === "POST") {
          let body = "";
          for await (const chunk of req as AsyncIterable<Buffer>) {
            body += chunk.toString();
          }
          const parsed = JSON.parse(body);
          const devices = engine!.snapshot().devices as Array<{ address: string; announcement: { port: number; deviceId: string } }>;
          const firstDevice = devices[0];
          if (!firstDevice) {
            res.writeHead(400);
            res.end(JSON.stringify({ error: "No devices discovered" }));
            return;
          }
          const transferId = await engine!.sendFiles(
            { host: firstDevice.address, port: firstDevice.announcement.port, deviceId: firstDevice.announcement.deviceId },
            parsed.files ?? []
          );
          sendJson({ transferId });
        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: "Not found" }));
        }
      } catch (err) {
        handleError(err);
      }
    }

    handleRequest();
  });

  httpServer.listen(HTTP_PORT, () => {
    console.log(`NexaShare HTTP API listening on port ${HTTP_PORT}`);
  });
}

function stopHttpServer(): void {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
}

app.whenReady().then(async () => {
  await initEngine();
  startHttpServer();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.handle("engine:create-pairing", async () => {
  if (!engine) throw new Error("Engine not initialized");
  return engine.createPairingSession();
});

ipcMain.handle("engine:send-files", async (_event, files: string[]) => {
  if (!engine) throw new Error("Engine not initialized");
  const devices = engine.snapshot?.().devices ?? [];
  const firstDevice = devices[0];
  if (!firstDevice) throw new Error("No devices discovered");
  return engine.sendFiles(
    { host: firstDevice.address, port: firstDevice.announcement.port, deviceId: firstDevice.announcement.deviceId },
    files
  );
});

ipcMain.handle("engine:unlock-laptop", async () => {
  if (!engine) throw new Error("Engine not initialized");
  await engine.unlockLaptop();
  return { ok: true };
});

ipcMain.handle("engine:snapshot", async () => {
  if (!engine) throw new Error("Engine not initialized");
  return engine.snapshot();
});

ipcMain.handle("dialog:open-files", async () => {
  if (!mainWindow) return [];
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile", "multiSelections"]
  });
  return result.filePaths ?? [];
});

ipcMain.handle("engine:stop", async () => {
  if (engine) {
    await engine.stop();
    engine = null;
  }
});

app.on("before-quit", async () => {
  stopHttpServer();
  if (engine) {
    await engine.stop();
  }
});
