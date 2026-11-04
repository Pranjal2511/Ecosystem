export { NexaEngine, type EngineOptions } from "./engine.js";
export { createDeviceIdentity, fingerprintFromCertPem, pairingProof, sha256Buffer, requireFingerprint } from "./crypto.js";
export { assertPinnedFingerprint, pinnedHttpsAgent } from "./tls-pin.js";
export { DiscoveryService } from "./discovery.js";
export { receiveFileStream } from "./incoming.js";
export {
  NopUnlockProvider,
  WindowsHelloUnlockProvider,
  createDefaultUnlockProvider
} from "./unlock-provider.js";
export type { UnlockProvider } from "./unlock-provider.js";
