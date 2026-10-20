import dgram from "node:dgram";
import {
  DISCOVERY_MULTICAST_IPV4,
  DISCOVERY_PORT,
  DISCOVERY_TTL_MS,
  type DiscoveryAnnouncement
} from "@nexashare/protocol";
import { KeyedRateLimiter, NexaError } from "@nexashare/shared";
import { parseDiscoveryPacket } from "@nexashare/validation";
import { EventEmitter } from "node:events";

export interface DiscoveredDevice {
  announcement: DiscoveryAnnouncement;
  address: string;
  lastSeenAt: number;
}

export class DiscoveryService extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private announceTimer: NodeJS.Timeout | null = null;
  private expireTimer: NodeJS.Timeout | null = null;
  private readonly devices = new Map<string, DiscoveredDevice>();
  private readonly limiter = new KeyedRateLimiter(8, 4);

  constructor(
    private readonly localDeviceId: string,
    private readonly buildAnnouncement: () => DiscoveryAnnouncement
  ) {
    super();
  }

  list(): DiscoveredDevice[] {
    return [...this.devices.values()].filter((d) => d.announcement.deviceId !== this.localDeviceId);
  }

  async start(): Promise<void> {
    if (this.socket) {
      return;
    }
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket = socket;
    socket.on("message", (msg, rinfo) => this.onMessage(msg, rinfo.address));
    socket.on("error", (error) => this.emit("error", error));
    await new Promise<void>((resolve) => {
      socket.bind(DISCOVERY_PORT, () => {
        try {
          socket.addMembership(DISCOVERY_MULTICAST_IPV4);
          socket.setMulticastTTL(1);
          socket.setMulticastLoopback(true);
        } catch (error) {
          this.emit("error", error instanceof Error ? error : new Error(String(error)));
        }
        resolve();
      });
    });
    this.announceTimer = setInterval(() => this.announce(), 2000);
    this.expireTimer = setInterval(() => this.expire(), 2000);
    this.announce();
  }

  stop(): void {
    if (this.announceTimer) {
      clearInterval(this.announceTimer);
    }
    if (this.expireTimer) {
      clearInterval(this.expireTimer);
    }
    this.announceTimer = null;
    this.expireTimer = null;
    this.socket?.close();
    this.socket = null;
    this.devices.clear();
  }

  private announce(): void {
    if (!this.socket) {
      return;
    }
    const payload = Buffer.from(JSON.stringify(this.buildAnnouncement()), "utf8");
    this.socket.send(payload, DISCOVERY_PORT, DISCOVERY_MULTICAST_IPV4);
  }

  private onMessage(msg: Buffer, address: string): void {
    if (!this.limiter.allow(address)) {
      return;
    }
    try {
      const announcement = parseDiscoveryPacket(msg.toString("utf8"));
      if (announcement.deviceId === this.localDeviceId) {
        return;
      }
      const device: DiscoveredDevice = {
        announcement,
        address,
        lastSeenAt: Date.now()
      };
      this.devices.set(announcement.deviceId, device);
      this.emit("devices", this.list());
    } catch (error) {
      if (error instanceof NexaError) {
        this.emit("invalid-packet", { address, code: error.code });
        return;
      }
    }
  }

  private expire(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, device] of this.devices) {
      if (now - device.lastSeenAt > DISCOVERY_TTL_MS) {
        this.devices.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.emit("devices", this.list());
    }
  }
}
