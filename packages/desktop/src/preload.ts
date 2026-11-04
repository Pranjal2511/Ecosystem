import { contextBridge, ipcRenderer } from "electron";

interface ElectronAPI {
  createPairing: () => Promise<{ pairingSessionId: string; code: string; expiresAt: number }>;
  sendFiles: (files: string[]) => Promise<string>;
  unlockLaptop: () => Promise<{ ok: boolean }>;
  snapshot: () => Promise<unknown>;
  openFiles: () => Promise<string[]>;
  stop: () => Promise<void>;
  on: (event: string, callback: (data: any) => void) => () => void;
  off: (event: string) => void;
}

const api: ElectronAPI = {
  createPairing: () => ipcRenderer.invoke("engine:create-pairing"),
  sendFiles: (files) => ipcRenderer.invoke("engine:send-files", files),
  unlockLaptop: () => ipcRenderer.invoke("engine:unlock-laptop"),
  snapshot: () => ipcRenderer.invoke("engine:snapshot"),
  openFiles: () => ipcRenderer.invoke("dialog:open-files"),
  stop: () => ipcRenderer.invoke("engine:stop"),
  on: (event, callback) => {
    ipcRenderer.on(event, (_event, data) => callback(data));
    return () => ipcRenderer.removeAllListeners(event);
  },
  off: (event) => {
    ipcRenderer.removeAllListeners(event);
  }
};

contextBridge.exposeInMainWorld("electronAPI", api);

export type { ElectronAPI };
