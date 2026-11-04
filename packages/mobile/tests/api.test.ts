import { describe, expect, it, vi } from "vitest";
import { HttpNexaShareApi } from "@nexashare/api-client";

describe("mobile app api client", () => {
  it("creates a new HttpApi instance", () => {
    const api = new HttpNexaShareApi("http://localhost:19529");
    expect(api).toBeInstanceOf(HttpNexaShareApi);
  });

  it("has methods defined", () => {
    const api = new HttpNexaShareApi("http://localhost:19529");
    expect(typeof api.createPairing).toBe("function");
    expect(typeof api.sendFiles).toBe("function");
    expect(typeof api.unlockLaptop).toBe("function");
    expect(typeof api.getSnapshot).toBe("function");
    expect(typeof api.stop).toBe("function");
    expect(typeof api.on).toBe("function");
  });

  it("uses custom base URL for requests", async () => {
    const api = new HttpNexaShareApi("http://custom:8080");
    const originalFetch = global.fetch;
    try {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true })
        } as Response)
      );
      await api.getSnapshot();
      expect(global.fetch).toHaveBeenCalledWith(
        "http://custom:8080/v1/snapshot",
        expect.any(Object)
      );
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("removes trailing slash from base URL", async () => {
    const api = new HttpNexaShareApi("http://localhost:19529/");
    const originalFetch = global.fetch;
    try {
      global.fetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true })
        } as Response)
      );
      await api.getSnapshot();
      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:19529/v1/snapshot",
        expect.any(Object)
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});