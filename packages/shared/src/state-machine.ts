import type { TransferState } from "@nexashare/protocol";
import { NexaError } from "./errors.js";

const ALLOWED: Record<TransferState, readonly TransferState[]> = {
  created: ["awaiting_approval", "cancelled", "failed"],
  awaiting_approval: ["accepted", "cancelled", "failed"],
  accepted: ["connecting", "cancelled", "failed", "interrupted"],
  connecting: ["transferring", "cancelled", "failed", "interrupted"],
  transferring: ["verifying", "cancelled", "failed", "interrupted"],
  verifying: ["completed", "failed", "cancelled", "interrupted"],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: ["connecting", "failed", "cancelled"]
};

export function canTransition(from: TransferState, to: TransferState): boolean {
  return ALLOWED[from].includes(to);
}

export function transition(from: TransferState, to: TransferState): TransferState {
  if (from === to) {
    return from;
  }
  if (!canTransition(from, to)) {
    throw new NexaError(
      "TRANSFER_STATE_INVALID",
      `Cannot transition transfer from ${from} to ${to}`
    );
  }
  return to;
}

export function isTerminal(state: TransferState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}
