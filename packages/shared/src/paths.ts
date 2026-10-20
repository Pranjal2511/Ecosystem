import { MAX_FILENAME_LENGTH, MAX_RELATIVE_PATH_LENGTH } from "@nexashare/protocol";
import { NexaError } from "./errors.js";

const WINDOWS_RESERVED = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9"
]);

// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[<>:"|?*\u0000-\u001f]/g;

export function sanitizeRelativePath(input: string): string {
  if (typeof input !== "string" || input.length === 0) {
    throw new NexaError("PATH_REJECTED", "Empty path");
  }
  if (input.length > MAX_RELATIVE_PATH_LENGTH) {
    throw new NexaError("PATH_REJECTED", "Path too long");
  }
  const normalized = input.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new NexaError("PATH_REJECTED", "Absolute paths are not allowed");
  }
  const parts = normalized.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new NexaError("PATH_REJECTED", "Empty path");
  }
  const safe = parts.map(sanitizePathSegment);
  return safe.join("/");
}

export function sanitizePathSegment(segment: string): string {
  if (segment === "." || segment === "..") {
    throw new NexaError("PATH_REJECTED", "Path traversal is not allowed");
  }
  if (segment.endsWith(".") || segment.endsWith(" ")) {
    throw new NexaError("PATH_REJECTED", "Invalid trailing characters");
  }
  const cleaned = segment.replace(UNSAFE_CHARS, "_");
  if (cleaned !== segment) {
    throw new NexaError("PATH_REJECTED", "Filename contains forbidden characters");
  }
  if (cleaned.length === 0 || cleaned.length > MAX_FILENAME_LENGTH) {
    throw new NexaError("PATH_REJECTED", "Invalid filename length");
  }
  const stem = cleaned.split(".")[0] ?? cleaned;
  if (WINDOWS_RESERVED.has(stem.toUpperCase())) {
    throw new NexaError("PATH_REJECTED", "Windows reserved filename");
  }
  return cleaned;
}

export function destinationFileName(original: string, attempt: number): string {
  if (attempt === 0) {
    return original;
  }
  const slash = original.lastIndexOf("/");
  const dir = slash === -1 ? "" : original.slice(0, slash + 1);
  const base = slash === -1 ? original : original.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) {
    return `${dir}${base} (${attempt})`;
  }
  return `${dir}${base.slice(0, dot)} (${attempt})${base.slice(dot)}`;
}

export function assertInsideRoot(root: string, resolved: string): void {
  const prefix = root.endsWith("\\") || root.endsWith("/") ? root : `${root}\\`;
  const unixPrefix = root.endsWith("/") ? root : `${root}/`;
  const ok =
    resolved === root ||
    resolved.toLowerCase().startsWith(prefix.toLowerCase()) ||
    resolved.startsWith(unixPrefix);
  if (!ok) {
    throw new NexaError("PATH_REJECTED", "Resolved path escaped the destination root");
  }
}
