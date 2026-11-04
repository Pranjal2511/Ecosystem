import type { NexaShareApi, NexaShareEvent, EventCallback, Snapshot, CreatePairingResult, UnlockResult } from "./types.js";

export abstract class BaseNexaShareApi implements NexaShareApi {
  protected listeners = new Map<string, Set<EventCallback>>();

  abstract createPairing(): Promise<CreatePairingResult>;
  abstract sendFiles(filePaths: string[]): Promise<string>;
  abstract unlockLaptop(): Promise<UnlockResult>;
  abstract getSnapshot(): Promise<Snapshot>;
  abstract stop(): Promise<void>;

  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }

  protected emit(event: NexaShareEvent): void {
    this.listeners.get(event.type)?.forEach((cb) => cb(event));
  }
}
