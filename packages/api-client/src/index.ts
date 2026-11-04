export type {
  PairingSession,
  DiscoveredDevice,
  PairedDevice,
  TransferRecord,
  Snapshot,
  UnlockResult,
  CreatePairingResult,
  NexaShareEvent,
  EventCallback,
  NexaShareApi
} from "./types.js";

export { BaseNexaShareApi } from "./client.js";
export { ElectronNexaShareApi } from "./electron-client.js";
export { HttpNexaShareApi } from "./http-client.js";
