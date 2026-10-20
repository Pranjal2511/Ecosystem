import type { NexaApi } from "../preload/index";

declare global {
  interface Window {
    nexa: NexaApi;
  }
}

export {};
