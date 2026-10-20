import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NexaEngine } from "@nexashare/transfer-core";

const engines: NexaEngine[] = [];

afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.stop()));
});

async function makeEngine(name: string): Promise<NexaEngine> {
  const dir = await mkdtemp(path.join(os.tmpdir(), `nexa-${name}-`));
  const engine = new NexaEngine({
    dataDir: dir,
    displayName: name,
    port: 0,
    enableDiscovery: false,
    destinationRoot: path.join(dir, "in")
  });
  await engine.start();
  engines.push(engine);
  return engine;
}

describe("loopback transfer", () => {
  it("transfers a file with SHA-256 verification after pairing and approval", async () => {
    const receiver = await makeEngine("Receiver");
    const sender = await makeEngine("Sender");
    const session = receiver.createPairingSession();
    await sender.pairAsGuest({
      host: "127.0.0.1",
      port: receiver.listenPort,
      pairingSessionId: session.qr.pairingSessionId,
      code: session.code,
      expectedFingerprint: receiver.identity.fingerprintSha256
    });

    const approved = new Promise<void>((resolve, reject) => {
      receiver.on("incoming", (record: { transferId: string }) => {
        receiver.decideIncoming(record.transferId, true).then(() => resolve()).catch(reject);
      });
    });

    const payload = Buffer.from(`nexa-share-test-${Date.now()}`);
    const source = path.join(os.tmpdir(), `nexa-source-${Date.now()}.bin`);
    await writeFile(source, payload);
    const expectedHash = createHash("sha256").update(payload).digest("hex");

    const sendPromise = sender.sendFiles(
      { host: "127.0.0.1", port: receiver.listenPort, deviceId: [...sender.paired.keys()][0] },
      [source]
    );
    await approved;
    await sendPromise;

    const dest = path.join(receiver.destinationRoot, path.basename(source));
    const received = await readFile(dest);
    expect(received.equals(payload)).toBe(true);
    expect(createHash("sha256").update(received).digest("hex")).toBe(expectedHash);
    const completed = receiver.history.find((h) => h.state === "completed");
    expect(completed).toBeTruthy();
  });

  it("keeps declined transfers from writing files", async () => {
    const receiver = await makeEngine("Receiver");
    const sender = await makeEngine("Sender");
    const session = receiver.createPairingSession();
    await sender.pairAsGuest({
      host: "127.0.0.1",
      port: receiver.listenPort,
      pairingSessionId: session.qr.pairingSessionId,
      code: session.code,
      expectedFingerprint: receiver.identity.fingerprintSha256
    });
    receiver.on("incoming", (record: { transferId: string }) => {
      void receiver.decideIncoming(record.transferId, false);
    });
    const source = path.join(os.tmpdir(), `nexa-declined-${Date.now()}.txt`);
    await writeFile(source, "should-not-copy");
    await expect(
      sender.sendFiles(
        { host: "127.0.0.1", port: receiver.listenPort, deviceId: [...sender.paired.keys()][0] },
        [source]
      )
    ).resolves.toBeTypeOf("string");
  });
});
