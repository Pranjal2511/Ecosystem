import { createHash } from "node:crypto";
import https from "node:https";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NexaEngine } from "@nexashare/transfer-core";
import { randomUuid } from "@nexashare/shared";

let engine: NexaEngine | undefined;

afterEach(async () => {
  await engine?.stop();
});

describe("unauthenticated upload", () => {
  it("rejects PUT without a valid session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "nexa-unauth-"));
    engine = new NexaEngine({
      dataDir: dir,
      displayName: "Solo",
      port: 0,
      enableDiscovery: false,
      destinationRoot: path.join(dir, "in")
    });
    await engine.start();
    const status = await new Promise<number>((resolve, reject) => {
      const req = https.request(
        {
          host: "127.0.0.1",
          port: engine!.listenPort,
          method: "PUT",
          path: `/v1/transfers/${randomUuid()}/files/0`,
          rejectUnauthorized: false,
          headers: { "Content-Length": 4 }
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on("error", reject);
      req.end("test");
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(createHash("sha256").update("x").digest("hex")).toHaveLength(64);
  });
});
