import { BaseNexaShareApi } from "./client.js";
export class HttpNexaShareApi extends BaseNexaShareApi {
    baseUrl;
    constructor(baseUrl = "http://localhost:19529") {
        super();
        this.baseUrl = baseUrl.replace(/\/$/, "");
    }
    async request(path, options = {}) {
        const res = await fetch(`${this.baseUrl}${path}`, {
            headers: { "Content-Type": "application/json", ...options.headers },
            ...options
        });
        if (!res.ok) {
            const errorText = await res.text().catch(() => "");
            throw new Error(`API error ${res.status}: ${errorText}`);
        }
        return res.json();
    }
    async createPairing() {
        return this.request("/v1/pairing/create", { method: "POST" });
    }
    async sendFiles(filePaths) {
        return this.request("/v1/transfers/send", {
            method: "POST",
            body: JSON.stringify({ files: filePaths })
        });
    }
    async unlockLaptop() {
        return this.request("/v1/unlock", { method: "POST" });
    }
    async getSnapshot() {
        return this.request("/v1/snapshot");
    }
    async stop() {
        await this.request("/v1/stop", { method: "POST" });
    }
}
