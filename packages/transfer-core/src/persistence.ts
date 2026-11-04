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
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as PersistedState;
  } catch {
    throw new Error(`Corrupt state file at ${filePath}`);
  }
}

export async function saveState(filePath: string, state: PersistedState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
}
