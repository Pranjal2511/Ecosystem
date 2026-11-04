import { ipcRenderer } from "electron";
import type { Snapshot, CreatePairingResult, UnlockResult } from "./types.js";
import { BaseNexaShareApi } from "./client.js";

export class ElectronNexaShareApi extends BaseNexaShareApi {
  async createPairing(): Promise<CreatePairingResult> {
    return ipcRenderer.invoke("engine:create-pairing");
  }

  async sendFiles(filePaths: string[]): Promise<string> {
    return ipcRenderer.invoke("engine:send-files", filePaths);
  }

  async unlockLaptop(): Promise<UnlockResult> {
    return ipcRenderer.invoke("engine:unlock-laptop");
  }

  async getSnapshot(): Promise<Snapshot> {
    return ipcRenderer.invoke("engine:snapshot");
  }

  async stop(): Promise<void> {
    return ipcRenderer.invoke("engine:stop");
  }

  private setupListeners(): void {
    ipcRenderer.on("status:snapshot", (_event, data: Snapshot) => {
      this.emit({ type: "status:snapshot", payload: data });
    });
    ipcRenderer.on("devices:update", (_event, data: unknown[]) => {
      this.emit({ type: "devices:update", payload: data as unknown as any });
    });
    ipcRenderer.on("transfer:incoming", (_event, data: unknown) => {
      this.emit({ type: "transfer:incoming", payload: data as any });
    });
  }

  constructor() {
    super();
    this.setupListeners();
  }
}

declare const globalThis: {
  nexashareApi?: ElectronNexaShareApi;
};

if (typeof window !== "undefined" && !globalThis.nexashareApi) {
  globalThis.nexashareApi = new ElectronNexaShareApi();
}
