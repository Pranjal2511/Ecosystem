import { describe, expect, it, vi } from "vitest";
import { ElectronNexaShareApi } from "@nexashare/api-client";
import type { Snapshot, CreatePairingResult, UnlockResult } from "@nexashare/api-client/types";

describe("desktop app", () => {
  it("creates a new Api instance", () => {
    const api = new ElectronNexaShareApi();
    expect(api).toBeInstanceOf(ElectronNexaShareApi);
  });

  it("has methods defined", () => {
    const api = new ElectronNexaShareApi();
    expect(typeof api.createPairing).toBe("function");
    expect(typeof api.sendFiles).toBe("function");
    expect(typeof api.unlockLaptop).toBe("function");
    expect(typeof api.getSnapshot).toBe("function");
    expect(typeof api.stop).toBe("function");
    expect(typeof api.on).toBe("function");
  });

  it("defaults snapshot endpoint", async () => {
    const api = new ElectronNexaShareApi();
    const originalFetch = global.fetch;
    try {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ deviceId: "test" })
        } as Response)
      );
      const result = await api.getSnapshot();
      expect(result).toHaveProperty("deviceId", "test");
    } finally {
      global.fetch = originalFetch;
    }
  });
});