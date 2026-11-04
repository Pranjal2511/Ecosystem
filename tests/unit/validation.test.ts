import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@nexashare/protocol";
import { parseControlEnvelope, parseDiscoveryPacket } from "@nexashare/validation";

describe("protocol validation", () => {
  it("accepts a well-formed discovery packet", () => {
    const packet = parseDiscoveryPacket(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        type: "announce",
        deviceId: "11111111-1111-4111-8111-111111111111",
        displayName: "Desk",
        port: 19529,
        capabilities: ["files", "sha256"],
        protocolMin: 1,
        protocolMax: 1,
        fingerprintSha256: "a".repeat(64)
      })
    );
    expect(packet.displayName).toBe("Desk");
  });

  it("rejects oversized discovery packets", () => {
    expect(() => parseDiscoveryPacket("x".repeat(2000))).toThrow();
  });

  it("rejects malformed discovery json", () => {
    expect(() => parseDiscoveryPacket("{not-json")).toThrow();
  });

  it("rejects unsupported protocol versions", () => {
    expect(() =>
      parseDiscoveryPacket(
        JSON.stringify({
          v: 99,
          type: "announce",
          deviceId: "11111111-1111-4111-8111-111111111111",
          displayName: "Desk",
          port: 19529,
          capabilities: ["files"],
          protocolMin: 99,
          protocolMax: 99,
          fingerprintSha256: "a".repeat(64)
        })
      )
    ).toThrow();
  });

  it("rejects invalid control envelopes", () => {
    expect(() => parseControlEnvelope(JSON.stringify({ v: 1 }))).toThrow();
  });
});
