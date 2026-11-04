import type { Snapshot, CreatePairingResult, UnlockResult } from "./types.js";
import { BaseNexaShareApi } from "./client.js";

export class HttpNexaShareApi extends BaseNexaShareApi {
  private baseUrl: string;

  constructor(baseUrl: string = "http://localhost:19529") {
    super();
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request(path: string, options: RequestInit = {}): Promise<unknown> {
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

  async createPairing(): Promise<CreatePairingResult> {
    return this.request("/v1/pairing/create", { method: "POST" }) as Promise<CreatePairingResult>;
  }

  async sendFiles(filePaths: string[]): Promise<string> {
    return this.request("/v1/transfers/send", {
      method: "POST",
      body: JSON.stringify({ files: filePaths })
    }) as Promise<string>;
  }

  async unlockLaptop(): Promise<UnlockResult> {
    return this.request("/v1/unlock", { method: "POST" }) as Promise<UnlockResult>;
  }

  async getSnapshot(): Promise<Snapshot> {
    return this.request("/v1/snapshot") as Promise<Snapshot>;
  }

  async stop(): Promise<void> {
    await this.request("/v1/stop", { method: "POST" });
  }
}
