import { describe, expect, it } from "vitest";
import { canTransition, transition } from "@nexashare/shared";

describe("transfer state machine", () => {
  it("allows the happy path", () => {
    expect(transition("created", "awaiting_approval")).toBe("awaiting_approval");
    expect(transition("awaiting_approval", "accepted")).toBe("accepted");
    expect(transition("accepted", "connecting")).toBe("connecting");
    expect(transition("connecting", "transferring")).toBe("transferring");
    expect(transition("transferring", "verifying")).toBe("verifying");
    expect(transition("verifying", "completed")).toBe("completed");
  });

  it("rejects invalid jumps", () => {
    expect(canTransition("created", "completed")).toBe(false);
    expect(() => transition("completed", "transferring")).toThrow();
    expect(() => transition("failed", "completed")).toThrow();
  });

  it("allows interruption recovery into connecting", () => {
    expect(canTransition("interrupted", "connecting")).toBe(true);
  });
});
