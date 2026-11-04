import React, { useState, useEffect, useCallback, Component, ErrorInfo } from "react";
import { ElectronNexaShareApi } from "@nexashare/api-client";

declare global {
  interface Window {
    electronAPI?: {
      openFiles: () => Promise<string[]>;
    };
  }
}

const api = new ElectronNexaShareApi();

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): { hasError: boolean; error: Error | null } {
    return { hasError: true, error };
  }

    override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div style={styles.card}>
          <h2>Something went wrong</h2>
          <p>{this.state.error?.message || "An unknown error occurred"}</p>
          <button className="btn btn-primary" onClick={() => {
            this.setState({ hasError: false, error: null });
          }}>
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type TransferState =
  | "created"
  | "awaiting_approval"
  | "accepted"
  | "connecting"
  | "transferring"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

interface FileOffer {
  index: number;
  relativePath: string;
  sizeBytes: number;
  sha256Hex?: string;
}

interface TransferRecord {
  transferId: string;
  direction: "send" | "receive";
  peerDeviceId: string;
  peerDisplayName: string;
  state: TransferState;
  files: FileOffer[];
  totalBytes: number;
  bytesTransferred: number;
  createdAt: number;
  updatedAt: number;
}

interface DiscoveredDevice {
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

interface PairedDevice {
  deviceId: string;
  displayName: string;
  fingerprintSha256: string;
  pairedAt: number;
  lastSeenAt: number;
  revoked: boolean;
}

interface Snapshot {
  identity: { deviceId: string; displayName: string; fingerprintSha256: string };
  port: number;
  destinationRoot: string;
  clipboardSyncEnabled: boolean;
  onboardingComplete: boolean;
  paired: PairedDevice[];
  history: TransferRecord[];
  devices: DiscoveredDevice[];
  transfers: TransferRecord[];
  pairing: { id: string; code: string; expiresAt: number }[];
  unlockSupported: boolean;
}

type View = "home" | "pairing" | "devices" | "transfers" | "unlock" | "incoming" | "verify";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function App() {
  const [view, setView] = useState<View>("home");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedFile, setSelectedFile] = useState<string[]>([]);
  const [incomingTransfer, setIncomingTransfer] = useState<TransferRecord | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockResult, setUnlockResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [fingerprintVerify, setFingerprintVerify] = useState<{ deviceId: string; displayName: string; fingerprint: string; localFingerprint: string } | null>(null);

  const loadSnapshot = useCallback(async () => {
    try {
      const data = await api.getSnapshot();
      setSnapshot(data as Snapshot);
    } catch {
      // Ignore snapshot load errors
    }
  }, [api]);

  useEffect(() => {
    loadSnapshot();

    const unsubStatus = api.on("status:snapshot", ((event: any) => setSnapshot(event.payload)) as any);
    const unsubDevices = api.on("devices:update", ((event: any) => {
      const snap = snapshot;
      if (snap) setSnapshot({ ...snap, devices: event.payload });
    }) as any);
    const unsubIncoming = api.on("transfer:incoming", ((event: any) => {
      setIncomingTransfer(event.payload);
      setView("incoming");
    }) as any);

    return () => {
      unsubStatus();
      unsubDevices();
      unsubIncoming();
    };
  }, [api, snapshot, loadSnapshot]);

  const handleCreatePairing = async () => {
    try {
      const result = await api.createPairing();
      setSnapshot((prev) => {
        if (!prev) return prev;
        return { ...prev, pairing: [...prev.pairing, { id: result.pairingSessionId, code: result.code, expiresAt: result.expiresAt }] };
      });
      setView("pairing");
    } catch (err: any) {
      console.error("Pairing failed:", err);
    }
  };

  const handleSelectFiles = async () => {
    try {
      const files = await window.electronAPI?.openFiles();
      if (files && files.length > 0) {
        setSelectedFile(files);
      }
    } catch {
      // Ignore
    }
  };

  const handleSendFiles = async () => {
    if (!api || selectedFile.length === 0) return;
    try {
      await api.sendFiles(selectedFile);
      setSelectedFile([]);
      setView("transfers");
    } catch (err: any) {
      console.error("Send failed:", err);
    }
  };

  const handleUnlock = async () => {
    setIsUnlocking(true);
    setUnlockResult(null);
    try {
      const result = await api.unlockLaptop();
      setUnlockResult(result);
    } catch (err: any) {
      setUnlockResult({ ok: false, message: err?.message || "Unlock failed" });
    } finally {
      setIsUnlocking(false);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleAcceptIncoming = async (accepted: boolean) => {
    if (!incomingTransfer) return;
    setIncomingTransfer(null);
    setView("transfers");
  };

  const handleFingerprintConfirm = async () => {
    if (!fingerprintVerify) return;
    setView("pairing");
    setFingerprintVerify(null);
  };

  const handleFingerprintCancel = () => {
    setFingerprintVerify(null);
    setView("devices");
  };

  const handleVerifyDevice = (device: any) => {
    const localFingerprint = snapshot?.identity?.fingerprintSha256 || "";
    setFingerprintVerify({
      deviceId: device.announcement.deviceId,
      displayName: device.announcement.displayName,
      fingerprint: device.announcement.fingerprintSha256,
      localFingerprint
    });
    setView("verify");
  };

  const pairedDevices = snapshot?.paired.filter((p) => !p.revoked) ?? [];
  const devices = snapshot?.devices ?? [];
  const transfers = snapshot?.history ?? [];
  const pairing = snapshot?.pairing ?? [];

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div style={styles.title}>
          <span style={styles.logo}>N</span>
          <span>NexaShare</span>
        </div>
        <div style={styles.nav}>
          <button onClick={() => setView("home")} className={view === "home" ? "active" : ""}>Home</button>
          <button onClick={() => setView("devices")} className={view === "devices" ? "active" : ""}>Devices</button>
          <button onClick={() => setView("transfers")} className={view === "transfers" ? "active" : ""}>Transfers</button>
          <button onClick={handleCreatePairing} className={view === "pairing" ? "active" : ""}>Pair</button>
          <button onClick={() => setView("unlock")} className={view === "unlock" ? "active" : ""}>Unlock</button>
        </div>
        <div style={styles.userInfo}>
          {snapshot?.identity && (
            <div style={styles.userBadge}>
              <div style={styles.userName}>{snapshot.identity.displayName}</div>
              <div style={styles.userId}>{snapshot.identity.deviceId.slice(0, 8)}...</div>
            </div>
          )}
        </div>
      </header>

      <main style={styles.main}>
        {view === "home" && (
          <ErrorBoundary>
            <HomeView snapshot={snapshot} />
          </ErrorBoundary>
        )}
        {view === "pairing" && (
          <ErrorBoundary>
            <PairingView pairing={pairing} onCreate={handleCreatePairing} />
          </ErrorBoundary>
        )}
        {view === "devices" && (
          <ErrorBoundary>
            <DevicesView devices={devices} paired={pairedDevices} onPair={handleCreatePairing} onVerify={handleVerifyDevice} />
          </ErrorBoundary>
        )}
        {view === "transfers" && (
          <ErrorBoundary>
            <TransfersView transfers={transfers} onSend={handleSendFiles} selectedFiles={selectedFile} onSelectFiles={handleSelectFiles} />
          </ErrorBoundary>
        )}
        {view === "unlock" && (
          <ErrorBoundary>
            <UnlockView supported={snapshot?.unlockSupported ?? false} onUnlock={handleUnlock} isUnlocking={isUnlocking} result={unlockResult} />
          </ErrorBoundary>
        )}
        {view === "incoming" && incomingTransfer && (
          <ErrorBoundary>
            <IncomingView record={incomingTransfer} onDecision={handleAcceptIncoming} />
          </ErrorBoundary>
        )}
        {view === "verify" && fingerprintVerify && (
          <ErrorBoundary>
            <FingerprintVerifyView data={fingerprintVerify} onConfirm={handleFingerprintConfirm} onCancel={handleFingerprintCancel} />
          </ErrorBoundary>
        )}
      </main>
    </div>
  );
}

function HomeView({ snapshot }: { snapshot: Snapshot | null }) {
  const paired = snapshot?.paired.filter((p) => !p.revoked).length ?? 0;
  const devices = snapshot?.devices.length ?? 0;
  const transfers = snapshot?.history.length ?? 0;
  const unlocked = snapshot?.unlockSupported ?? false;

  return (
    <div style={styles.dashboard}>
      <h2>Dashboard</h2>
      <div style={styles.statGrid}>
        <StatCard title="Paired Devices" value={String(paired)} icon="🔗" />
        <StatCard title="Discovered" value={String(devices)} icon="📡" />
        <StatCard title="Transfers" value={String(transfers)} icon="📁" />
        <StatCard title="Remote Unlock" value={unlocked ? "Ready" : "Not Supported"} icon={unlocked ? "🔓" : "🔒"} />
      </div>
      <div style={styles.quickActions}>
        <h3>Quick Actions</h3>
        <div style={styles.buttonRow}>
          <button className="btn btn-primary" onClick={handleSendFilesDesktop}>
            Send Files
          </button>
          <button className="btn btn-secondary">Discover Devices</button>
          {unlocked && (
            <button className="btn btn-success" style={{ background: "#10b981" }}>
              Unlock Laptop
            </button>
          )}
        </div>
      </div>
    </div>
  );

  function handleSendFilesDesktop() {
    // Triggered from parent
  }
}

function PairingView({ pairing, onCreate }: { pairing: any[]; onCreate: () => void }) {
  return (
    <div style={styles.card}>
      <h2>Pair Device</h2>
      <p>Scan the QR code from your phone or enter the 6-digit code manually.</p>
      <div style={styles.pairingPanel}>
        <div style={styles.qrCode}>
          <div style={styles.qrPlaceholder}>QR CODE</div>
          <div style={styles.qrData}>{pairing[pairing.length - 1]?.id || "—"}</div>
        </div>
        <div style={styles.codePanel}>
          <h3>Pairing Code</h3>
          <div style={styles.bigCode}>{pairing[pairing.length - 1]?.code || "—"}</div>
          <div style={styles.expiresAt}>Expires: {pairing[pairing.length - 1]?.expiresAt ? new Date(pairing[pairing.length - 1].expiresAt).toLocaleTimeString() : "—"}</div>
        </div>
      </div>
      <div style={styles.buttonRow}>
        <button className="btn btn-primary" onClick={onCreate}>New Session</button>
        <button className="btn btn-secondary">Refresh</button>
      </div>
    </div>
  );
}

function DevicesView({ devices, paired, onPair, onVerify }: { devices: any[]; paired: any[]; onPair: () => void; onVerify: (d: any) => void }) {
  return (
    <div style={styles.card}>
      <h2>Devices</h2>
      <div style={styles.buttonRow}>
        <button className="btn btn-primary" onClick={onPair}>Pair New Device</button>
      </div>
      <h3 style={styles.sectionTitle}>Discovered</h3>
      <div style={styles.list}>
        {devices.length === 0 ? <div style={styles.empty}>No devices discovered</div> : (
          devices.map((d) => (
            <div key={d.announcement.deviceId} style={styles.deviceRow}>
              <div>
                <div style={styles.deviceName}>{d.announcement.displayName}</div>
                <div style={styles.deviceId}>{d.announcement.deviceId.slice(0, 8)}... • {d.address}</div>
              </div>
              <div style={styles.transferActions}>
                <button className="btn btn-small" onClick={() => onVerify(d)}>Verify</button>
              </div>
            </div>
          ))
        )}
      </div>
      <h3 style={styles.sectionTitle}>Paired</h3>
      <div style={styles.list}>
        {paired.length === 0 ? <div style={styles.empty}>No paired devices</div> : (
          paired.map((p) => (
            <div key={p.deviceId} style={styles.deviceRow}>
              <div>
                <div style={styles.deviceName}>{p.displayName}</div>
                <div style={styles.deviceId}>{p.deviceId.slice(0, 8)}...</div>
              </div>
              <span style={styles.badge}>Paired</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TransfersView({
  transfers,
  onSend,
  selectedFiles,
  onSelectFiles
}: {
  transfers: any[];
  onSend: () => void;
  selectedFiles: string[];
  onSelectFiles: () => void;
}) {
  return (
    <div style={styles.card}>
      <h2>Transfers</h2>
      <div style={styles.buttonRow}>
        <button className="btn btn-primary" onClick={onSelectFiles}>Select Files</button>
        <button className="btn btn-success" onClick={onSend} disabled={selectedFiles.length === 0}>
          Send ({selectedFiles.length})
        </button>
      </div>
      <div style={styles.list}>
        {transfers.length === 0 ? <div style={styles.empty}>No transfers yet</div> : (
          transfers.map((t) => (
            <div key={t.transferId} style={styles.transferRow}>
              <div>
                <div style={styles.transferName}>{t.direction === "send" ? "Sending to" : "Receiving from"} {t.peerDisplayName}</div>
                <div style={styles.transferProgress}>
                  {formatBytes(t.bytesTransferred)} / {formatBytes(t.totalBytes)}
                </div>
                <div style={styles.transferState}>{t.state}</div>
              </div>
              <div style={styles.transferActions}>
                {t.state === "awaiting_approval" && (
                  <>
                    <button className="btn btn-small" style={{ background: "#10b981" }} onClick={() => {}}>Accept</button>
                    <button className="btn btn-small" style={{ background: "#ef4444" }} onClick={() => {}}>Decline</button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function UnlockView({
  supported,
  onUnlock,
  isUnlocking,
  result
}: {
  supported: boolean;
  onUnlock: () => void;
  isUnlocking: boolean;
  result: { ok: boolean; message?: string } | null;
}) {
  return (
    <div style={styles.card}>
      <h2>Fingerprint Unlock</h2>
      <p>Unlock this laptop remotely from your paired phone.</p>
      {!supported ? (
        <div style={styles.alert}>
          <strong>Not supported on this device.</strong> Install a platform unlock provider (e.g., Windows Hello) to enable remote unlock.
        </div>
      ) : (
        <div style={styles.unlockPanel}>
          <div style={styles.unlockIcon}>🔓</div>
          <button
            className="btn btn-unlock"
            onClick={onUnlock}
            disabled={isUnlocking}
            style={styles.unlockButton}
          >
            {isUnlocking ? "Unlocking..." : "Unlock Laptop"}
          </button>
          {result && (
            <div style={{ ...styles.resultBox, background: result.ok ? "#dcfce7" : "#fecaca", color: result.ok ? "#166534" : "#991b1b" }}>
              {result.ok ? "✅ " : "❌ "}{result.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IncomingView({ record, onDecision }: { record: any; onDecision: (accepted: boolean) => void }) {
  return (
    <div style={styles.card}>
      <h2>Incoming Transfer</h2>
      <div style={styles.alert}>
        <strong>{record.peerDisplayName}</strong> wants to send you {record.files.length} file(s) ({formatBytes(record.totalBytes)}).
      </div>
      <div style={styles.buttonRow}>
        <button className="btn btn-success" onClick={() => onDecision(true)}>Accept</button>
        <button className="btn btn-secondary" onClick={() => onDecision(false)}>Decline</button>
      </div>
    </div>
  );
}

function FingerprintVerifyView({ data, onConfirm, onCancel }: { data: { deviceId: string; displayName: string; fingerprint: string; localFingerprint: string }; onConfirm: () => void; onCancel: () => void }) {
  const match = data.fingerprint === data.localFingerprint;
  return (
    <div style={styles.card}>
      <h2>Verify Fingerprint</h2>
      <p>Confirm that the fingerprint matches on both devices before pairing.</p>
      <div style={styles.fingerprintPanel}>
        <div style={styles.fingerprintSide}>
          <div style={styles.fingerprintLabel}>This Device</div>
          <div style={styles.fingerprintValue}>{data.localFingerprint}</div>
        </div>
        <div style={styles.fingerprintSide}>
          <div style={styles.fingerprintLabel}>{data.displayName}</div>
          <div style={styles.fingerprintValue}>{data.fingerprint}</div>
        </div>
      </div>
      <div style={styles.matchIndicator}>
        {match ? "✅ Fingerprints match" : "❌ Fingerprints do NOT match"}
      </div>
      <div style={styles.buttonRow}>
        <button className="btn btn-success" onClick={onConfirm} disabled={!match}>
          {match ? "Confirm & Pair" : "Cannot Pair"}
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: string }) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statIcon}>{icon}</div>
      <div style={styles.statValue}>{value}</div>
      <div style={styles.statTitle}>{title}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: { display: "flex", flexDirection: "column", height: "100vh", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", background: "#f8fafc", color: "#0f172a" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", background: "#ffffff", borderBottom: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
  title: { display: "flex", alignItems: "center", gap: "12px" },
  logo: { width: "32px", height: "32px", background: "#3b82f6", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: "bold", fontSize: "18px" },
  nav: { display: "flex", gap: "8px" },
  userInfo: { display: "flex", alignItems: "center", gap: "12px" },
  userBadge: { display: "flex", flexDirection: "column", fontSize: "13px" },
  userName: { fontWeight: "600" },
  userId: { color: "#64748b" },
  main: { flex: 1, overflow: "auto", padding: "24px" },
  dashboard: { maxWidth: "900px", margin: "0 auto" },
  statGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "24px" },
  statCard: { background: "#fff", padding: "20px", borderRadius: "12px", border: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: "12px" },
  statIcon: { fontSize: "24px" },
  statValue: { fontSize: "28px", fontWeight: "700", marginLeft: "8px" },
  statTitle: { color: "#64748b", fontSize: "14px", marginLeft: "8px" },
  quickActions: { background: "#fff", padding: "24px", borderRadius: "12px", border: "1px solid #e2e8f0" },
  buttonRow: { display: "flex", gap: "12px", marginTop: "16px", flexWrap: "wrap" },
  btn: { padding: "10px 20px", borderRadius: "8px", border: "none", fontSize: "14px", fontWeight: "500", cursor: "pointer", transition: "all 0.2s" },
  "btn-primary": { background: "#3b82f6", color: "#fff" },
  "btn-secondary": { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" },
  "btn-success": { background: "#10b981", color: "#fff" },
  "btn-small": { padding: "6px 12px", fontSize: "12px" },
  "btn-unlock": { background: "#10b981", color: "#fff", width: "100%", padding: "16px", fontSize: "16px", fontWeight: "600", borderRadius: "12px" },
  card: { background: "#fff", padding: "24px", borderRadius: "12px", border: "1px solid #e2e8f0", maxWidth: "500px", margin: "0 auto" },
  sectionTitle: { fontSize: "16px", fontWeight: "600", marginTop: "20px", marginBottom: "12px" },
  list: { display: "flex", flexDirection: "column", gap: "8px" },
  empty: { color: "#94a3b8", fontStyle: "italic", padding: "16px" },
  deviceRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderBottom: "1px solid #f1f5f9" },
  deviceName: { fontWeight: "600" },
  deviceId: { fontSize: "12px", color: "#64748b" },
  badge: { background: "#dbeafe", color: "#1e40af", padding: "2px 8px", borderRadius: "12px", fontSize: "11px", fontWeight: "600" },
  transferRow: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderBottom: "1px solid #f1f5f9" },
  transferName: { fontWeight: "600" },
  transferProgress: { fontSize: "13px", color: "#64748b" },
  transferState: { fontSize: "12px", fontWeight: "600", color: "#3b82f6" },
  transferActions: { display: "flex", gap: "6px" },
  pairingPanel: { display: "flex", gap: "24px", alignItems: "center", justifyContent: "center", margin: "24px 0" },
  qrCode: { width: "200px", height: "200px", border: "2px dashed #cbd5e1", borderRadius: "12px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#f8fafc" },
  qrPlaceholder: { fontSize: "48px", marginBottom: "8px" },
  qrData: { fontSize: "12px", color: "#64748b", fontFamily: "monospace" },
  codePanel: { flex: 1 },
  bigCode: { fontSize: "48px", fontWeight: "700", letterSpacing: "8px", fontFamily: "monospace", textAlign: "center", marginBottom: "8px" },
  expiresAt: { fontSize: "13px", color: "#64748b", textAlign: "center" },
  fingerprintPanel: { display: "flex", gap: "24px", alignItems: "center", justifyContent: "center", margin: "24px 0" },
  fingerprintSide: { display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", padding: "16px", background: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0", flex: 1 },
  fingerprintLabel: { fontSize: "13px", color: "#64748b", fontWeight: "600" },
  fingerprintValue: { fontSize: "11px", fontFamily: "monospace", color: "#0f172a", wordBreak: "break-all", textAlign: "center" },
  matchIndicator: { fontSize: "14px", fontWeight: "600", textAlign: "center", margin: "16px 0" },
  unlockPanel: { textAlign: "center", padding: "32px 0" },
  unlockIcon: { fontSize: "64px", marginBottom: "16px" },
  unlockButton: { marginTop: "16px" },
  resultBox: { marginTop: "16px", padding: "12px", borderRadius: "8px" },
  alert: { padding: "12px", borderRadius: "8px", background: "#fef3c7", color: "#92400e", margin: "16px 0" },
  h2: { margin: "0 0 12px 0", fontSize: "20px", fontWeight: "600" },
  h3: { margin: "0 0 12px 0", fontSize: "16px", fontWeight: "600" }
};
