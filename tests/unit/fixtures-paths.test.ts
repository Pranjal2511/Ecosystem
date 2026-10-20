import { describe, expect, it } from "vitest";
import { PATH_FIXTURES } from "@nexashare/protocol";
import { NexaError, sanitizeRelativePath } from "@nexashare/shared";

describe("protocol path fixtures", () => {
  it("accepts documented safe paths", () => {
    for (const sample of PATH_FIXTURES.accept) {
      expect(sanitizeRelativePath(sample)).toBe(sample);
    }
  });

  it("rejects documented unsafe paths", () => {
    for (const sample of PATH_FIXTURES.reject) {
      expect(() => sanitizeRelativePath(sample)).toThrow(NexaError);
    }
  });
});
