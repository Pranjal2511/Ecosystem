import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NexaEngine } from "@nexashare/transfer-core";
import { NexaError } from "@nexashare/shared";

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

describe("pairing security", () => {
  it("pairs with a valid short-lived code", async () => {
    const host = await makeEngine("Host");
    const guest = await makeEngine("Guest");
    const session = host.createPairingSession();
    await guest.pairAsGuest({
      host: "127.0.0.1",
      port: host.listenPort,
      pairingSessionId: session.qr.pairingSessionId,
      code: session.code,
      expectedFingerprint: host.identity.fingerprintSha256
    });
    expect(guest.paired.size).toBe(1);
    expect(host.paired.size).toBe(1);
  });

  it("rejects a wrong pairing code", async () => {
    const host = await makeEngine("Host");
    const guest = await makeEngine("Guest");
    const session = host.createPairingSession();
    await expect(
      guest.pairAsGuest({
        host: "127.0.0.1",
        port: host.listenPort,
        pairingSessionId: session.qr.pairingSessionId,
        code: session.code === "000000" ? "000001" : "000000",
        expectedFingerprint: host.identity.fingerprintSha256
      })
    ).rejects.toBeInstanceOf(NexaError);
  });

  it("rejects a consumed pairing session", async () => {
    const host = await makeEngine("Host");
    const guest = await makeEngine("Guest");
    const extra = await makeEngine("Extra");
    const session = host.createPairingSession();
    await guest.pairAsGuest({
      host: "127.0.0.1",
      port: host.listenPort,
      pairingSessionId: session.qr.pairingSessionId,
      code: session.code,
      expectedFingerprint: host.identity.fingerprintSha256
    });
    await expect(
      extra.pairAsGuest({
        host: "127.0.0.1",
        port: host.listenPort,
        pairingSessionId: session.qr.pairingSessionId,
        code: session.code,
        expectedFingerprint: host.identity.fingerprintSha256
      })
    ).rejects.toBeInstanceOf(NexaError);
  });

  it("revoked devices cannot send files", async () => {
    const host = await makeEngine("Host");
    const guest = await makeEngine("Guest");
    const session = host.createPairingSession();
    await guest.pairAsGuest({
      host: "127.0.0.1",
      port: host.listenPort,
      pairingSessionId: session.qr.pairingSessionId,
      code: session.code,
      expectedFingerprint: host.identity.fingerprintSha256
    });
    const guestId = [...host.paired.keys()][0]!;
    host.revokeDevice(guestId);
    const file = path.join(os.tmpdir(), "nexa-revoke.txt");
    await writeFile(file, "revoke-test");
    await expect(
      guest.sendFiles({ host: "127.0.0.1", port: host.listenPort, deviceId: [...guest.paired.keys()][0] }, [
        file
      ])
    ).rejects.toBeInstanceOf(Error);
  });
});
