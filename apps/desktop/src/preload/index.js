"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const api = {
  snapshot: () => ipcRenderer.invoke("nexa:snapshot"),
  onStatus: (cb) => {
    const listener = (_event, snapshot) => cb(snapshot);
    ipcRenderer.on("nexa:status", listener);
    return () => ipcRenderer.removeListener("nexa:status", listener);
  },
  completeOnboarding: () => ipcRenderer.invoke("nexa:complete-onboarding"),
  setName: (name) => ipcRenderer.invoke("nexa:set-name", name),
  createPairing: () => ipcRenderer.invoke("nexa:create-pairing"),
  pairGuest: (payload) => ipcRenderer.invoke("nexa:pair-guest", payload),
  parseQr: (raw) => ipcRenderer.invoke("nexa:pair-qr", raw),
  pickFiles: () => ipcRenderer.invoke("nexa:pick-files"),
  pickDestination: () => ipcRenderer.invoke("nexa:pick-folder-destination"),
  sendFiles: (payload) => ipcRenderer.invoke("nexa:send-files", payload),
  decide: (payload) => ipcRenderer.invoke("nexa:decide", payload),
  revoke: (deviceId) => ipcRenderer.invoke("nexa:revoke", deviceId),
  unpair: (deviceId) => ipcRenderer.invoke("nexa:unpair", deviceId),
  clearHistory: () => ipcRenderer.invoke("nexa:clear-history"),
  setClipboardSync: (enabled) => ipcRenderer.invoke("nexa:clipboard-sync", enabled),
  openDestination: () => ipcRenderer.invoke("nexa:open-destination"),
  diagnostics: () => ipcRenderer.invoke("nexa:diagnostics")
};

contextBridge.exposeInMainWorld("nexa", api);
