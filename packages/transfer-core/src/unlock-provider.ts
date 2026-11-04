import { NexaError } from "@nexashare/shared";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";

const execFileAsync = promisify(execFile);

export interface UnlockProvider {
  readonly supported: boolean;
  unlock(): Promise<void>;
}

export class NopUnlockProvider implements UnlockProvider {
  readonly supported = false;
  async unlock(): Promise<void> {
    throw new NexaError("UNLOCK_NOT_SUPPORTED", "Remote unlock is not supported on this device");
  }
}

export class WindowsHelloUnlockProvider implements UnlockProvider {
  readonly supported = os.platform() === "win32";

  async unlock(): Promise<void> {
    if (!this.supported) {
      throw new NexaError("UNLOCK_NOT_SUPPORTED", "Windows Hello is only available on Windows");
    }

    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Unlock request from NexaShare. Press OK to unlock.', 'NexaShare Remote Unlock', 'OKCancel', 'Warning')"
      ], { timeout: 30000 });

      if (stdout.includes("OK")) {
        return;
      }
      throw new NexaError("UNLOCK_FAILED", "User cancelled the unlock request");
    } catch (error) {
      if (error instanceof NexaError) {
        throw error;
      }
      throw new NexaError("UNLOCK_FAILED", (error as Error).message || "Unknown error during unlock");
    }
  }
}

export function createDefaultUnlockProvider(): UnlockProvider {
  if (os.platform() === "win32") {
    return new WindowsHelloUnlockProvider();
  }
  return new NopUnlockProvider();
}
