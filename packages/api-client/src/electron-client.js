import { ipcRenderer } from "electron";
import { BaseNexaShareApi } from "./client.js";
export class ElectronNexaShareApi extends BaseNexaShareApi {
    async createPairing() {
        return ipcRenderer.invoke("engine:create-pairing");
    }
    async sendFiles(filePaths) {
        return ipcRenderer.invoke("engine:send-files", filePaths);
    }
    async unlockLaptop() {
        return ipcRenderer.invoke("engine:unlock-laptop");
    }
    async getSnapshot() {
        return ipcRenderer.invoke("engine:snapshot");
    }
    async stop() {
        return ipcRenderer.invoke("engine:stop");
    }
    setupListeners() {
        ipcRenderer.on("status:snapshot", (_event, data) => {
            this.emit({ type: "status:snapshot", payload: data });
        });
        ipcRenderer.on("devices:update", (_event, data) => {
            this.emit({ type: "devices:update", payload: data });
        });
        ipcRenderer.on("transfer:incoming", (_event, data) => {
            this.emit({ type: "transfer:incoming", payload: data });
        });
    }
    constructor() {
        super();
        this.setupListeners();
    }
}
if (typeof window !== "undefined" && !globalThis.nexashareApi) {
    globalThis.nexashareApi = new ElectronNexaShareApi();
}
