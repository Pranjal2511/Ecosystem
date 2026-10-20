import { createHash, timingSafeEqual } from "node:crypto";
import https from "node:https";
import tls, { type ConnectionOptions } from "node:tls";
import { NexaError, isFingerprintFormat, normalizeFingerprint } from "@nexashare/shared";

export function fingerprintFromDer(der: Buffer): string {
  return createHash("sha256").update(der).digest("hex");
}

export function assertExpectedFingerprint(expected: string | undefined | null): string {
  const value = normalizeFingerprint(expected);
  if (!isFingerprintFormat(value)) {
    throw new NexaError("UNAUTHENTICATED", "Peer certificate fingerprint is required");
  }
  return value;
}

export function assertPinnedFingerprint(expected: string | undefined | null, actualDer: Buffer | undefined): string {
  const want = assertExpectedFingerprint(expected);
  if (!actualDer || actualDer.length === 0) {
    throw new NexaError("UNAUTHENTICATED", "Peer did not present a TLS certificate");
  }
  const got = fingerprintFromDer(actualDer);
  const left = Buffer.from(want, "hex");
  const right = Buffer.from(got, "hex");
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new NexaError("UNAUTHENTICATED", "Certificate fingerprint mismatch");
  }
  return got;
}

export function pinnedHttpsAgent(expectedFingerprint: string): https.Agent {
  const expected = assertExpectedFingerprint(expectedFingerprint);
  const agent = new https.Agent({
    rejectUnauthorized: false,
    maxCachedSessions: 0
  });
  agent.createConnection = (options, callback) => {
    let finished = false;
    const done = (error: Error | null, socket?: tls.TLSSocket) => {
      if (finished) {
        return;
      }
      finished = true;
      callback?.(error, socket as tls.TLSSocket);
    };
    const socket = tls.connect({ ...(options as ConnectionOptions), rejectUnauthorized: false }, () => {
      try {
        assertPinnedFingerprint(expected, socket.getPeerCertificate().raw);
        done(null, socket);
      } catch (error) {
        socket.destroy();
        done(error as Error, undefined);
      }
    });
    socket.once("error", (error) => done(error, undefined));
    return socket;
  };
  return agent;
}
