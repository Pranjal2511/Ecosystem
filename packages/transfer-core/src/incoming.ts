import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { FileOffer } from "@nexashare/protocol";
import { NexaError, assertInsideRoot, destinationFileName, sanitizeRelativePath } from "@nexashare/shared";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface ReceivedFile {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  sha256Hex: string;
}

export function tempRootFor(destinationRoot: string, transferId: string): string {
  return path.join(destinationRoot, ".nexashare-tmp", transferId);
}

export async function receiveFileStream(options: {
  destinationRoot: string;
  transferId: string;
  offer: FileOffer;
  stream: Readable;
  existingNames: Set<string>;
}): Promise<ReceivedFile> {
  const relative = sanitizeRelativePath(options.offer.relativePath);
  const root = path.resolve(options.destinationRoot);
  const tmpDir = tempRootFor(root, options.transferId);
  await mkdir(tmpDir, { recursive: true });
  const partPath = path.join(tmpDir, `${options.offer.index}.part`);
  if (!partPath.startsWith(tmpDir)) {
    throw new NexaError("PATH_REJECTED", "Temporary path escaped the temp root");
  }

  const hash = createHash("sha256");
  let written = 0;
  const writable = createWriteStream(partPath, { flags: "wx" });
  writable.on("pipe", () => undefined);

  await pipeline(
    options.stream,
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        written += chunk.length;
        if (written > options.offer.sizeBytes) {
          throw new NexaError("SIZE_MISMATCH", "Received more bytes than declared");
        }
        hash.update(chunk);
        yield chunk;
      }
    },
    writable
  );

  if (written !== options.offer.sizeBytes) {
    await unlink(partPath).catch(() => undefined);
    throw new NexaError("SIZE_MISMATCH", `Expected ${options.offer.sizeBytes} bytes, received ${written}`);
  }

  const sha256Hex = hash.digest("hex");
  if (options.offer.sha256Hex && options.offer.sha256Hex.toLowerCase() !== sha256Hex) {
    await unlink(partPath).catch(() => undefined);
    throw new NexaError("HASH_MISMATCH", "SHA-256 did not match the declared digest");
  }

  let attempt = 0;
  let finalRelative = destinationFileName(relative, attempt);
  let finalPath = path.resolve(root, finalRelative);
  assertInsideRoot(root, finalPath);
  while (options.existingNames.has(finalRelative) || (await exists(finalPath))) {
    attempt += 1;
    finalRelative = destinationFileName(relative, attempt);
    finalPath = path.resolve(root, finalRelative);
    assertInsideRoot(root, finalPath);
    if (attempt > 99) {
      throw new NexaError("FILE_INVALID", "Could not allocate a unique destination name");
    }
  }

  await mkdir(path.dirname(finalPath), { recursive: true });
  await rename(partPath, finalPath);
  options.existingNames.add(finalRelative);
  return {
    relativePath: finalRelative,
    absolutePath: finalPath,
    sizeBytes: written,
    sha256Hex
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
