import React, { useState, useEffect, useCallback } from "react";
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
  TextInput
} from "react-native";
import DocumentPicker from "react-native-document-picker";

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

type ViewName = "home" | "pairing" | "devices" | "transfers" | "unlock" | "incoming" | "settings";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function App() {
  const [view, setView] = useState<ViewName>("home");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<{ name: string; uri: string; type: string; size: number }[]>([]);
  const [incomingTransfer, setIncomingTransfer] = useState<TransferRecord | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [unlockResult, setUnlockResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [desktopIp, setDesktopIp] = useState<string>("");

  const baseUrl = desktopIp ? `http://${desktopIp}:19529` : "http://localhost:19529";

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/v1/snapshot`);
      if (res.ok) {
        const data = (await res.json()) as Snapshot;
        setSnapshot(data);
      }
    } catch {
      // Server may not be reachable
    }
  }, [baseUrl]);

  useEffect(() => {
    fetchSnapshot();
    const interval = setInterval(fetchSnapshot, 5000);
    return () => clearInterval(interval);
  }, [fetchSnapshot]);

  const handleCreatePairing = async () => {
    try {
      const res = await fetch(`${baseUrl}/v1/pairing/create`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setSnapshot((prev) => {
          if (!prev) return prev;
          return { ...prev, pairing: [...prev.pairing, { id: data.pairingSessionId, code: data.code, expiresAt: data.expiresAt }] };
        });
        setView("pairing");
      } else {
        Alert.alert("Error", "Failed to create pairing session");
      }
    } catch {
      Alert.alert("Error", "Cannot reach desktop app. Make sure it's running.");
    }
  };

  const handleSendFiles = async () => {
    if (selectedFiles.length === 0) {
      Alert.alert("Info", "Please select files first.");
      return;
    }
    try {
      const res = await fetch(`${baseUrl}/v1/transfers/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: selectedFiles.map((f) => f.uri) })
      });
      if (res.ok) {
        const data = await res.json();
        Alert.alert("Success", `Transfer started: ${data.transferId}`);
        setSelectedFiles([]);
        setView("transfers");
      } else {
        const data = await res.json().catch(() => ({}));
        Alert.alert("Error", data.error || "Failed to send files");
      }
    } catch {
      Alert.alert("Error", "Cannot reach desktop app. Make sure it's running.");
    }
  };

  const handleSelectFiles = async () => {
    try {
      const result = await DocumentPicker.pick({
        type: [Platform.OS === "ios" ? "public.item" : "*/*"]
      } as any);
      setSelectedFiles(result.map((f: any) => ({
        name: f.name,
        uri: f.uri,
        type: f.type,
        size: f.size
      })));
    } catch (err: any) {
      if (err.code === "document_picker_cancelled") {
        return;
      }
      Alert.alert("Error", "Failed to pick files: " + (err?.message || "Unknown error"));
    }
  };

  const handleUnlock = async () => {
    setIsUnlocking(true);
    setUnlockResult(null);
    try {
      const res = await fetch(`${baseUrl}/v1/unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setUnlockResult({ ok: true, message: "Laptop unlocked successfully" });
      } else {
        setUnlockResult({ ok: false, message: data.message || "Unlock failed" });
      }
    } catch (err: any) {
      setUnlockResult({ ok: false, message: err?.message || "Cannot reach desktop" });
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleAcceptIncoming = async (accepted: boolean) => {
    if (!incomingTransfer) return;
    try {
      await fetch(`${baseUrl}/v1/transfers/${incomingTransfer.transferId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted })
      });
    } catch {
      Alert.alert("Error", "Failed to respond to transfer");
    }
    setIncomingTransfer(null);
    setView("transfers");
  };

  const pairedDevices = snapshot?.paired.filter((p) => !p.revoked) ?? [];
  const devices = snapshot?.devices ?? [];
  const transfers = snapshot?.history ?? [];
  const pairing = snapshot?.pairing ?? [];

  const pairedWithDesktop = pairedDevices.length > 0;

  return (
    <SafeAreaView style={styles.container}>
      <HeaderView title={view === "home" ? "NexaShare" : view === "pairing" ? "Pair Device" : view === "devices" ? "Devices" : view === "transfers" ? "Transfers" : view === "unlock" ? "Unlock Laptop" : view === "settings" ? "Settings" : "Incoming Transfer"} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {view === "home" && (
          <HomeView snapshot={snapshot} pairedWithDesktop={pairedWithDesktop} onPair={handleCreatePairing} onSend={handleSendFiles} onSelectFiles={handleSelectFiles} selectedFiles={selectedFiles} />
        )}
        {view === "pairing" && (
          <PairingView pairing={pairing} onCreate={handleCreatePairing} />
        )}
        {view === "devices" && (
          <DevicesView devices={devices} paired={pairedDevices} onPair={handleCreatePairing} />
        )}
        {view === "transfers" && (
          <TransfersView transfers={transfers} onSend={handleSendFiles} selectedFiles={selectedFiles} onSelectFiles={handleSelectFiles} />
        )}
        {view === "unlock" && (
          <UnlockView supported={snapshot?.unlockSupported ?? false} onUnlock={handleUnlock} isUnlocking={isUnlocking} result={unlockResult} />
        )}
        {view === "incoming" && incomingTransfer && (
          <IncomingView record={incomingTransfer} onDecision={handleAcceptIncoming} />
        )}
        {view === "settings" && (
          <SettingsView desktopIp={desktopIp} onChangeIp={setDesktopIp} />
        )}
      </ScrollView>
      <BottomNavView view={view} setView={setView} />
    </SafeAreaView>
  );
}

function HeaderView({ title }: { title: string }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <Text style={styles.headerTitle}>N</Text>
      </View>
      <Text style={styles.headerCenter}>{title}</Text>
      <View style={styles.headerRight} />
    </View>
  );
}

function BottomNavView({ view, setView }: { view: ViewName; setView: (v: ViewName) => void }) {
  const items: { id: ViewName; label: string; icon: string }[] = [
    { id: "home", label: "Home", icon: "🏠" },
    { id: "devices", label: "Devices", icon: "📡" },
    { id: "transfers", label: "Transfers", icon: "📁" },
    { id: "pairing", label: "Pair", icon: "🔗" },
    { id: "unlock", label: "Unlock", icon: "🔓" },
    { id: "settings", label: "Settings", icon: "⚙️" }
  ];

  return (
    <View style={styles.bottomNav}>
      {items.map((item) => (
        <TouchableOpacity
          key={item.id}
          style={[styles.navItem, view === item.id && styles.navItemActive]}
          onPress={() => setView(item.id)}
        >
          <Text style={[styles.navIcon, view === item.id && styles.navIconActive]}>{item.icon}</Text>
          <Text style={[styles.navLabel, view === item.id && styles.navLabelActive]}>{item.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function HomeView({ snapshot, pairedWithDesktop, onPair, onSend, onSelectFiles, selectedFiles }: any) {
  const paired = snapshot?.paired.filter((p: any) => !p.revoked).length ?? 0;
  const devices = snapshot?.devices.length ?? 0;
  const transfers = snapshot?.history.length ?? 0;
  const unlocked = snapshot?.unlockSupported ?? false;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Dashboard</Text>
      <View style={styles.statGrid}>
        <StatCard title="Paired" value={String(paired)} icon="🔗" />
        <StatCard title="Found" value={String(devices)} icon="📡" />
        <StatCard title="Transfers" value={String(transfers)} icon="📁" />
        <StatCard title="Unlock" value={unlocked ? "Ready" : "—"} icon={unlocked ? "🔓" : "🔒"} />
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onPair}>
          <Text style={styles.btnText}>Pair Device</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={onSelectFiles}>
          <Text style={styles.btnText}>Select Files ({selectedFiles?.length || 0})</Text>
        </TouchableOpacity>
      </View>
      {unlocked && (
        <TouchableOpacity style={[styles.btn, styles.btnUnlock]} onPress={onSend}>
          <Text style={styles.btnText}>🔓 Unlock Laptop</Text>
        </TouchableOpacity>
      )}
      {!pairedWithDesktop && (
        <View style={styles.empty}>
          <Text>No paired desktop yet. Tap "Pair Device" to connect.</Text>
        </View>
      )}
    </View>
  );
}

function PairingView({ pairing, onCreate }: { pairing: any[]; onCreate: () => void }) {
  const latest = pairing[pairing.length - 1];
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Pair with Desktop</Text>
      <Text style={styles.subtitle}>Show this screen to your desktop, or enter the code shown on desktop.</Text>
      <View style={styles.qrCard}>
        <View style={styles.qrPlaceholder}>📱</View>
        <Text style={styles.qrData}>{latest?.id || "—"}</Text>
      </View>
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>6-Digit Code</Text>
        <Text style={styles.bigCode}>{latest?.code || "—"}</Text>
        <Text style={styles.expires}>{latest?.expiresAt ? new Date(latest.expiresAt).toLocaleTimeString() : "—"}</Text>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onCreate}>
          <Text style={styles.btnText}>New Code</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function DevicesView({ devices, paired, onPair }: { devices: any[]; paired: any[]; onPair: () => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Devices</Text>
        <TouchableOpacity style={[styles.btn, styles.btnSmall, styles.btnSecondary]} onPress={onPair}>
          <Text style={styles.btnText}>Pair</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>Discovered on LAN</Text>
      <View style={styles.list}>
        {devices.length === 0 ? (
          <View style={styles.empty}>
            <Text>No devices found on this network.</Text>
          </View>
        ) : (
          devices.map((d: any) => (
            <View key={d.announcement.deviceId} style={styles.deviceRow}>
              <View>
                <Text style={styles.deviceName}>{d.announcement.displayName}</Text>
                <Text style={styles.deviceId}>{d.address}:{d.announcement.port}</Text>
              </View>
              <TouchableOpacity style={[styles.btn, styles.btnSmall, styles.btnPrimary]} onPress={() => {}}>
                <Text style={styles.btnText}>Pair</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>
      <Text style={{ ...styles.subtitle, marginTop: 16 }}>Paired</Text>
      <View style={styles.list}>
        {paired.length === 0 ? (
          <View style={styles.empty}>
            <Text>No paired devices.</Text>
          </View>
        ) : (
          paired.map((p: any) => (
            <View key={p.deviceId} style={styles.deviceRow}>
              <View>
                <Text style={styles.deviceName}>{p.displayName}</Text>
                <Text style={styles.deviceId}>{p.deviceId.slice(0, 8)}...</Text>
              </View>
              <View style={styles.badge}>Paired</View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function TransfersView({ transfers, onSend, selectedFiles, onSelectFiles }: any) {
  return (
    <View style={styles.card}>
      <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={onSelectFiles}>
        <Text style={styles.btnText}>Select Files ({selectedFiles?.length || 0})</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={onSend}>
        <Text style={styles.btnText}>Send</Text>
      </TouchableOpacity>
      <View style={styles.list}>
        {transfers.length === 0 ? (
          <View style={styles.empty}>
            <Text>No transfers yet.</Text>
          </View>
        ) : (
          transfers.map((t: any) => (
            <View key={t.transferId} style={styles.transferRow}>
              <View>
                <Text style={styles.deviceName}>{t.direction === "send" ? "→" : "←"} {t.peerDisplayName}</Text>
                <Text style={styles.deviceId}>{formatBytes(t.bytesTransferred)} / {formatBytes(t.totalBytes)}</Text>
              </View>
              <Text style={[styles.transferState, t.state === "completed" && { color: "#10b981" }]}>{t.state}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function UnlockView({ supported, onUnlock, isUnlocking, result }: { supported: boolean; onUnlock: () => void; isUnlocking: boolean; result: { ok: boolean; message?: string } | null }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Remote Unlock</Text>
      {!supported ? (
        <View style={styles.alert}>
          <Text style={styles.alertText}>Remote unlock not supported on this desktop.</Text>
        </View>
      ) : (
        <View style={styles.unlockPanel}>
          <Text style={{ ...styles.unlockIcon, fontSize: 64 }}>🔓</Text>
          <TouchableOpacity style={[styles.btn, styles.btnUnlock]} onPress={onUnlock} disabled={isUnlocking}>
            <Text style={styles.btnText}>{isUnlocking ? "Unlocking..." : "Unlock Laptop"}</Text>
          </TouchableOpacity>
          {result && (
            <View style={[styles.resultBox, result.ok ? styles.resultOk : styles.resultError]}>
              <Text style={styles.resultText}>{result.ok ? "✅ " : "❌ "}{result.message}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function IncomingView({ record, onDecision }: { record: any; onDecision: (accepted: boolean) => void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Incoming Transfer</Text>
      <View style={styles.alert}>
        <Text style={styles.alertText}>{record.peerDisplayName} wants to send {record.files.length} file(s) ({formatBytes(record.totalBytes)}).</Text>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => onDecision(true)}>
          <Text style={styles.btnText}>Accept</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => onDecision(false)}>
          <Text style={styles.btnText}>Decline</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statIcon}>{icon}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statTitle}>{title}</Text>
    </View>
  );
}

function SettingsView({ desktopIp, onChangeIp }: { desktopIp: string; onChangeIp: (ip: string) => void }) {
  const [ipInput, setIpInput] = useState(desktopIp);

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Desktop Connection</Text>
      <Text style={styles.subtitle}>Enter the IP address of your NexaShare desktop.</Text>
      <View style={styles.inputRow}>
        <TextInput style={styles.input} value={ipInput} onChangeText={setIpInput} placeholder="192.168.1.XX" />
        <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => onChangeIp(ipInput)}>
          <Text style={styles.btnText}>Save</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={() => onChangeIp("")}>
          <Text style={styles.btnText}>Reset to localhost</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.subtitle}>
        Current: {desktopIp || "localhost:19529"}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  scrollContent: { padding: 16, paddingBottom: 100 },
  header: { flexDirection: "row", alignItems: "center", padding: 16, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0" },
  headerLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  headerTitle: { fontSize: 28, fontWeight: "bold", color: "#3b82f6" },
  headerCenter: { fontSize: 18, fontWeight: "600", color: "#0f172a", flex: 1, textAlign: "center" },
  headerRight: { width: 40 },
  bottomNav: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  navItem: { alignItems: "center", padding: 6 },
  navItemActive: { },
  navIcon: { fontSize: 24, marginBottom: 4 },
  navIconActive: { color: "#3b82f6" },
  navLabel: { fontSize: 11, color: "#64748b" },
  navLabelActive: { color: "#3b82f6", fontWeight: "600" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: "#e2e8f0" },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: "600", color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#64748b", marginBottom: 12 },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  statCard: { flex: 1, minWidth: 85, backgroundColor: "#f1f5f9", borderRadius: 8, padding: 12, alignItems: "center" },
  statIcon: { fontSize: 20, marginBottom: 6 },
  statValue: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  statTitle: { fontSize: 11, color: "#64748b", textAlign: "center" },
  buttonRow: { flexDirection: "row", gap: 10 },
  btn: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 8, alignItems: "center", minWidth: 120 },
  btnPrimary: { backgroundColor: "#3b82f6" },
  btnSecondary: { backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#cbd5e1" },
  btnUnlock: { backgroundColor: "#10b981", marginTop: 12 },
  btnDisabled: { opacity: 0.5 },
  btnSmall: { paddingVertical: 8, paddingHorizontal: 14, minWidth: 70 },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  btnTextDisabled: { color: "#94a3b3" },
  empty: { alignItems: "center", padding: 24, color: "#94a3b8" },
  list: { gap: 8 },
  deviceRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  deviceName: { fontWeight: "600", color: "#0f172a" },
  deviceId: { fontSize: 12, color: "#64748b" },
  transferRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  transferState: { fontSize: 12, fontWeight: "600" },
  badge: { backgroundColor: "#dbeafe", color: "#1e40af", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, fontSize: 11, fontWeight: "600" },
  inputRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
  input: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, fontSize: 14, color: "#0f172a" },
  qrCard: { backgroundColor: "#f8fafc", borderWidth: 2, borderColor: "#cbd5e1", borderRadius: 12, alignItems: "center", padding: 24, marginBottom: 16 },
  qrPlaceholder: { fontSize: 48, marginBottom: 8 },
  qrData: { fontSize: 11, color: "#64748b", fontFamily: "monospace" },
  codeCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 16 },
  codeLabel: { fontSize: 13, color: "#64748b", marginBottom: 8 },
  bigCode: { fontSize: 40, fontWeight: "700", letterSpacing: 8, fontFamily: "monospace", color: "#0f172a" },
  expires: { fontSize: 12, color: "#64748b" },
  unlockPanel: { alignItems: "center", paddingVertical: 24 },
  unlockIcon: { marginBottom: 16 },
  resultBox: { marginTop: 16, padding: 12, borderRadius: 8, alignItems: "center" },
  resultOk: { backgroundColor: "#dcfce7" },
  resultError: { backgroundColor: "#fecaca" },
  resultText: { fontSize: 14, fontWeight: "600" },
  alert: { padding: 12, borderRadius: 8, backgroundColor: "#fef3c7" },
  alertText: { color: "#92400e", fontSize: 13 }
});
