import { describe, expect, it } from "vitest";
import { NexaError, destinationFileName, sanitizeRelativePath } from "@nexashare/shared";

describe("sanitizeRelativePath", () => {
  it("accepts a simple filename", () => {
    expect(sanitizeRelativePath("photo.jpg")).toBe("photo.jpg");
  });

  it("accepts nested relative folders", () => {
    expect(sanitizeRelativePath("album/vacation/pic.png")).toBe("album/vacation/pic.png");
  });

  it("rejects parent traversal", () => {
    expect(() => sanitizeRelativePath("../secret.txt")).toThrow(NexaError);
    expect(() => sanitizeRelativePath("ok/../../etc/passwd")).toThrow(NexaError);
  });

  it("rejects absolute windows and unix paths", () => {
    expect(() => sanitizeRelativePath("C:/Windows/notepad.exe")).toThrow(NexaError);
    expect(() => sanitizeRelativePath("/etc/passwd")).toThrow(NexaError);
  });

  it("rejects reserved windows names", () => {
    expect(() => sanitizeRelativePath("CON")).toThrow(NexaError);
    expect(() => sanitizeRelativePath("aux.txt")).toThrow(NexaError);
  });

  it("rejects forbidden characters", () => {
    expect(() => sanitizeRelativePath("hi<there>.txt")).toThrow(NexaError);
  });
});

describe("destinationFileName", () => {
  it("adds a numeric suffix before the extension", () => {
    expect(destinationFileName("report.pdf", 1)).toBe("report (1).pdf");
    expect(destinationFileName("folder/report.pdf", 2)).toBe("folder/report (2).pdf");
  });
});
