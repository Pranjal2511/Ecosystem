export interface PairingSession {
  id: string;
  code: string;
  expiresAt: number;
}

export interface DiscoveredDevice {
  announcement: {
    deviceId: string;
    displayName: string;
    port: number;
    capabilities: string[];
    fingerprintSha256: string;
  };
  address: string;
  lastSeenAt: number;
}

export interface PairedDevice {
  deviceId: string;
  displayName: string;
  fingerprintSha256: string;
  pairedAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

export interface TransferRecord {
  transferId: string;
  direction: "send" | "receive";
  peerDeviceId: string;
  peerDisplayName: string;
  state: string;
  files: Array<{
    index: number;
    relativePath: string;
    sizeBytes: number;
    sha256Hex?: string;
  }>;
  totalBytes: number;
  bytesTransferred: number;
  createdAt: number;
  updatedAt: number;
}

export interface Snapshot {
  identity: {
    deviceId: string;
    displayName: string;
    fingerprintSha256: string;
  };
  port: number;
  destinationRoot: string;
  clipboardSyncEnabled: boolean;
  onboardingComplete: boolean;
  paired: PairedDevice[];
  history: TransferRecord[];
  devices: DiscoveredDevice[];
  transfers: TransferRecord[];
  pairing: PairingSession[];
  unlockSupported: boolean;
}

export interface UnlockResult {
  ok: boolean;
  message?: string;
}

export interface CreatePairingResult {
  pairingSessionId: string;
  code: string;
  expiresAt: number;
}

export type NexaShareEvent =
  | { type: "status:snapshot"; payload: Snapshot }
  | { type: "devices:update"; payload: DiscoveredDevice[] }
  | { type: "transfer:incoming"; payload: TransferRecord };

export type EventCallback = (event: NexaShareEvent) => void;

export interface NexaShareApi {
  createPairing(): Promise<CreatePairingResult>;
  sendFiles(filePaths: string[]): Promise<string>;
  unlockLaptop(): Promise<UnlockResult>;
  getSnapshot(): Promise<Snapshot>;
  stop(): Promise<void>;
  on(event: string, callback: EventCallback): () => void;
}
