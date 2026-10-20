import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

type Screen =
  | "welcome"
  | "dashboard"
  | "devices"
  | "send"
  | "receive"
  | "transfers"
  | "history"
  | "paired"
  | "settings"
  | "security"
  | "diagnostics"
  | "about";

type Snapshot = {
  identity: { deviceId: string; displayName: string; fingerprintSha256: string };
  port: number;
  destinationRoot: string;
  clipboardSyncEnabled: boolean;
  onboardingComplete: boolean;
  paired: Array<{ deviceId: string; displayName: string; revoked: boolean; fingerprintSha256: string }>;
  history: Array<{
    transferId: string;
    direction: string;
    peerDisplayName: string;
    state: string;
    totalBytes: number;
    bytesTransferred: number;
    files: Array<{ relativePath: string; sizeBytes: number }>;
  }>;
  devices: Array<{
    address: string;
    announcement: { deviceId: string; displayName: string; port: number; fingerprintSha256: string };
  }>;
  transfers: Array<{
    transferId: string;
    direction: string;
    peerDisplayName: string;
    state: string;
    totalBytes: number;
    bytesTransferred: number;
    files: Array<{ relativePath: string }>;
  }>;
  pairing: Array<{ id: string; code: string; expiresAt: number }>;
};

const NAV: Array<{ id: Screen; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "devices", label: "Nearby" },
  { id: "send", label: "Send" },
  { id: "receive", label: "Receive" },
  { id: "transfers", label: "Transfers" },
  { id: "history", label: "History" },
  { id: "paired", label: "Paired devices" },
  { id: "settings", label: "Settings" },
  { id: "security", label: "Security" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "about", label: "About" }
];

function bytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [screen, setScreen] = useState<Screen>("welcome");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [name, setName] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("19529");
  const [code, setCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const [selectedDevice, setSelectedDevice] = useState("");
  const [pickedFiles, setPickedFiles] = useState<string[]>([]);
  const [diagnostics, setDiagnostics] = useState<string>("");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    void window.nexa.snapshot().then((res) => {
      const body = res as { snapshot: Snapshot };
      setSnapshot(body.snapshot);
      setName(body.snapshot.identity.displayName);
      setScreen(body.snapshot.onboardingComplete ? "dashboard" : "welcome");
    });
    return window.nexa.onStatus((next) => setSnapshot(next as Snapshot));
  }, []);

  const incoming = useMemo(
    () => snapshot?.transfers.filter((t) => t.direction === "receive" && t.state === "awaiting_approval") ?? [],
    [snapshot]
  );

  async function refreshPairing(): Promise<void> {
    const res = (await window.nexa.createPairing()) as {
      pairing: { qr: unknown; code: string; expiresAt: number };
    };
    const url = await QRCode.toDataURL(JSON.stringify(res.pairing.qr), { margin: 1, width: 220 });
    setQrDataUrl(url);
  }

  if (!snapshot) {
    return <div className="main">Starting NexaShare…</div>;
  }

  if (screen === "welcome") {
    return (
      <div className="main">
        <div className="card" style={{ maxWidth: 560 }}>
          <svg className="logo" viewBox="0 0 64 64" aria-hidden="true">
            <rect width="64" height="64" rx="16" fill="#3d9a7a" />
            <path d="M18 34l10 10 18-22" fill="none" stroke="#07140f" strokeWidth="5" />
          </svg>
          <h2>Welcome to NexaShare</h2>
          <p className="muted">
            Local, account-free file sharing. Devices on the same Wi-Fi can pair with a short-lived code and transfer
            files over TLS. Incoming transfers always ask for approval.
          </p>
          <div className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Device name" />
            <button
              onClick={async () => {
                await window.nexa.setName(name);
                await window.nexa.completeOnboarding();
                setScreen("dashboard");
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <nav className="nav" aria-label="Primary">
        <div className="brand">
          <svg className="logo" viewBox="0 0 64 64" role="img" aria-label="NexaShare">
            <rect width="64" height="64" rx="16" fill="#3d9a7a" />
            <path d="M14 40V24l18 16 18-16v16" fill="none" stroke="#07140f" strokeWidth="4" />
          </svg>
          <div>
            <h1>NexaShare</h1>
            <div className="muted">{snapshot.identity.displayName}</div>
          </div>
        </div>
        {NAV.map((item) => (
          <button key={item.id} className={screen === item.id ? "active" : ""} onClick={() => setScreen(item.id)}>
            {item.label}
          </button>
        ))}
        <button className="secondary" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
      </nav>
      <main className="main">
        {notice ? <p className="muted">{notice}</p> : null}

        {screen === "dashboard" && (
          <section className="grid">
            <h2>Dashboard</h2>
            <div className="cards">
              <div className="card">
                <div className="muted">Listening port</div>
                <strong>{snapshot.port}</strong>
              </div>
              <div className="card">
                <div className="muted">Nearby devices</div>
                <strong>{snapshot.devices.length}</strong>
              </div>
              <div className="card">
                <div className="muted">Paired</div>
                <strong>{snapshot.paired.filter((p) => !p.revoked).length}</strong>
              </div>
              <div className="card">
                <div className="muted">Active transfers</div>
                <strong>{snapshot.transfers.filter((t) => t.state === "transferring").length}</strong>
              </div>
            </div>
            {incoming.length > 0 ? (
              <div className="card">
                <h3>Approval needed</h3>
                {incoming.map((item) => (
                  <div className="item" key={item.transferId}>
                    <div>
                      <strong>{item.peerDisplayName}</strong>
                      <div className="muted">
                        {item.files.length} file(s) · {bytes(item.totalBytes)}
                      </div>
                    </div>
                    <div className="row">
                      <button onClick={() => void window.nexa.decide({ transferId: item.transferId, accepted: true })}>
                        Accept
                      </button>
                      <button
                        className="danger"
                        onClick={() => void window.nexa.decide({ transferId: item.transferId, accepted: false })}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty">No incoming transfers waiting for approval.</div>
            )}
          </section>
        )}

        {screen === "devices" && (
          <section>
            <h2>Nearby devices</h2>
            <p className="muted">Discovered devices are not trusted until pairing succeeds.</p>
            <div className="list">
              {snapshot.devices.length === 0 ? (
                <div className="empty">No devices found. Check Wi-Fi, guest isolation, VPN, and firewall rules.</div>
              ) : (
                snapshot.devices.map((device) => (
                  <div className="item" key={device.announcement.deviceId}>
                    <div>
                      <strong>{device.announcement.displayName}</strong>
                      <div className="muted">
                        {device.address}:{device.announcement.port} · unpaired
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setHost(device.address);
                        setPort(String(device.announcement.port));
                        setFingerprint(device.announcement.fingerprintSha256);
                        setSelectedDevice(device.announcement.deviceId);
                        setScreen("receive");
                      }}
                    >
                      Pair
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {screen === "receive" && (
          <section className="grid">
            <h2>Receive and pair</h2>
            <div className="card">
              <p className="muted">Show this QR code or 6-digit code on the receiving Windows PC.</p>
              <div className="row">
                <button onClick={() => void refreshPairing()}>Generate pairing code</button>
              </div>
              {snapshot.pairing[0] ? (
                <p>
                  Code <strong>{snapshot.pairing[0].code}</strong> expires at{" "}
                  {new Date(snapshot.pairing[0].expiresAt).toLocaleTimeString()}
                </p>
              ) : null}
              {qrDataUrl ? <img className="qr" src={qrDataUrl} alt="Pairing QR code" /> : null}
            </div>
            <div className="card">
              <h3>Join another device</h3>
              <div className="row">
                <input value={host} onChange={(e) => setHost(e.target.value)} aria-label="Host" placeholder="IP address" />
                <input value={port} onChange={(e) => setPort(e.target.value)} aria-label="Port" placeholder="Port" />
                <input value={sessionId} onChange={(e) => setSessionId(e.target.value)} aria-label="Session id" placeholder="Pairing session ID" />
                <input value={code} onChange={(e) => setCode(e.target.value)} aria-label="Pairing code" placeholder="6-digit code" />
                <input
                  value={fingerprint}
                  onChange={(e) => setFingerprint(e.target.value)}
                  aria-label="Certificate fingerprint"
                  placeholder="SHA-256 fingerprint"
                />
                <button
                  onClick={async () => {
                    const res = (await window.nexa.pairGuest({
                      host,
                      port: Number(port),
                      pairingSessionId: sessionId,
                      code,
                      expectedFingerprint: fingerprint
                    })) as { ok: boolean; error?: string };
                    setNotice(res.ok ? "Paired successfully." : res.error ?? "Pairing failed");
                  }}
                >
                  Pair now
                </button>
              </div>
            </div>
          </section>
        )}

        {screen === "send" && (
          <section className="grid">
            <h2>Send files</h2>
            <div className="card">
              <p className="muted">Choose a paired device, then pick files. Drag-and-drop is also supported below.</p>
              <div className="row">
                <select
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  aria-label="Paired device"
                >
                  <option value="">Select paired device</option>
                  {snapshot.paired
                    .filter((p) => !p.revoked)
                    .map((p) => (
                      <option key={p.deviceId} value={p.deviceId}>
                        {p.displayName}
                      </option>
                    ))}
                </select>
                <input value={host} onChange={(e) => setHost(e.target.value)} aria-label="Destination host" />
                <input value={port} onChange={(e) => setPort(e.target.value)} aria-label="Destination port" />
                <button
                  className="secondary"
                  onClick={async () => {
                    const res = (await window.nexa.pickFiles()) as { files: string[] };
                    setPickedFiles(res.files ?? []);
                  }}
                >
                  Choose files
                </button>
                <button
                  disabled={!selectedDevice || pickedFiles.length === 0}
                  onClick={async () => {
                    const res = (await window.nexa.sendFiles({
                      host,
                      port: Number(port),
                      deviceId: selectedDevice,
                      files: pickedFiles
                    })) as { ok: boolean; error?: string };
                    setNotice(res.ok ? "Transfer started." : res.error ?? "Send failed");
                    setScreen("transfers");
                  }}
                >
                  Send
                </button>
              </div>
              <div
                className="empty"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const files = Array.from(e.dataTransfer.files)
                    .map((f) => (f as File & { path?: string }).path)
                    .filter((p): p is string => Boolean(p));
                  if (files.length) {
                    setPickedFiles(files);
                  }
                }}
              >
                {pickedFiles.length ? pickedFiles.map((f) => <div key={f}>{f}</div>) : "Drop files here"}
              </div>
            </div>
          </section>
        )}

        {screen === "transfers" && (
          <section>
            <h2>Active transfers</h2>
            {snapshot.transfers.length === 0 ? (
              <div className="empty">No transfers in this session queue.</div>
            ) : (
              snapshot.transfers.map((t) => {
                const pct = t.totalBytes ? Math.min(100, Math.round((t.bytesTransferred / t.totalBytes) * 100)) : 0;
                return (
                  <div className="card" key={t.transferId}>
                    <div className="item">
                      <div>
                        <strong>
                          {t.direction} · {t.peerDisplayName}
                        </strong>
                        <div className="muted">
                          {t.state} · {bytes(t.bytesTransferred)} / {bytes(t.totalBytes)}
                        </div>
                      </div>
                      <span className="badge">{t.state}</span>
                    </div>
                    <div className="progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })
            )}
          </section>
        )}

        {screen === "history" && (
          <section>
            <h2>History</h2>
            <button className="secondary" onClick={() => void window.nexa.clearHistory()}>
              Clear history
            </button>
            {snapshot.history.length === 0 ? (
              <div className="empty">No transfers yet.</div>
            ) : (
              snapshot.history
                .slice()
                .reverse()
                .map((t) => (
                  <div className="item" key={t.transferId}>
                    <div>
                      {t.peerDisplayName} · {t.files[0]?.relativePath}
                      <div className="muted">
                        {t.direction} · {bytes(t.totalBytes)}
                      </div>
                    </div>
                    <span className={`badge ${t.state === "completed" ? "ok" : "warn"}`}>{t.state}</span>
                  </div>
                ))
            )}
          </section>
        )}

        {screen === "paired" && (
          <section>
            <h2>Paired devices</h2>
            {snapshot.paired.map((p) => (
              <div className="item" key={p.deviceId}>
                <div>
                  <strong>{p.displayName}</strong>
                  <div className="muted">
                    {p.revoked ? "revoked" : "trusted"} · {p.fingerprintSha256.slice(0, 16)}…
                  </div>
                </div>
                <div className="row">
                  <button className="secondary" onClick={() => void window.nexa.revoke(p.deviceId)}>
                    Revoke
                  </button>
                  <button className="danger" onClick={() => void window.nexa.unpair(p.deviceId)}>
                    Unpair
                  </button>
                </div>
              </div>
            ))}
            {snapshot.paired.length === 0 ? <div className="empty">No paired devices.</div> : null}
          </section>
        )}

        {screen === "settings" && (
          <section className="grid">
            <h2>Settings</h2>
            <div className="card">
              <p>Download folder: {snapshot.destinationRoot}</p>
              <div className="row">
                <button onClick={() => void window.nexa.pickDestination()}>Change folder</button>
                <button className="secondary" onClick={() => void window.nexa.openDestination()}>
                  Open folder
                </button>
              </div>
            </div>
            <div className="card">
              <p>Clipboard synchronization is opt-in and disabled by default.</p>
              <button
                className="secondary"
                onClick={() => void window.nexa.setClipboardSync(!snapshot.clipboardSyncEnabled)}
              >
                {snapshot.clipboardSyncEnabled ? "Disable clipboard sync" : "Enable clipboard sync"}
              </button>
              <p className="muted">
                When disabled, clipboard contents are never transmitted. Android background clipboard access is limited
                by the OS.
              </p>
            </div>
          </section>
        )}

        {screen === "security" && (
          <section className="card">
            <h2>Security</h2>
            <p>Device ID: {snapshot.identity.deviceId}</p>
            <p>Certificate fingerprint: {snapshot.identity.fingerprintSha256}</p>
            <p className="muted">
              NexaShare uses per-device TLS certificates. Pairing pins the certificate fingerprint. Discovery never
              proves identity. Incoming files require approval. Filenames are sanitized against path traversal.
            </p>
          </section>
        )}

        {screen === "diagnostics" && (
          <section>
            <h2>Network diagnostics</h2>
            <button
              onClick={async () => {
                const res = (await window.nexa.diagnostics()) as { diagnostics: unknown };
                setDiagnostics(JSON.stringify(res.diagnostics, null, 2));
              }}
            >
              Collect diagnostics
            </button>
            <pre className="card">{diagnostics || "Run diagnostics if discovery or pairing fails."}</pre>
            <ul>
              <li>Confirm both devices are on the same Wi-Fi, not a guest network with client isolation.</li>
              <li>Allow TCP {snapshot.port} and UDP 19528 inbound for NexaShare in Windows Firewall.</li>
              <li>Disconnect VPNs that force tunnel all LAN traffic.</li>
              <li>If multicast is blocked, pair with IP, port, fingerprint, and code.</li>
            </ul>
          </section>
        )}

        {screen === "about" && (
          <section className="card">
            <h2>About NexaShare</h2>
            <p>Version 0.1.0 · local-first · no account · no cloud.</p>
            <p className="muted">
              Protocol v1 with TLS, SHA-256 verification, and explicit pairing. See the docs folder in the repository.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
