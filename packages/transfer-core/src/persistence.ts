import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PairedDeviceRecord, TransferRecord } from "@nexashare/protocol";
import type { DeviceIdentity } from "./crypto.js";

export interface PersistedState {
  identity: DeviceIdentity;
  paired: PairedDeviceRecord[];
  history: TransferRecord[];
  destinationRoot: string;
  clipboardSyncEnabled: boolean;
  onboardingComplete: boolean;
}

export async function loadState(filePath: string): Promise<PersistedState | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

export async function saveState(filePath: string, state: PersistedState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await writeFile(filePath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
}
