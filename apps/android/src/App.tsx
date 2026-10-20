import { useMemo, useState } from "react";
import {
  NativeModules,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

type NativeEngine = {
  start: (displayName: string) => Promise<string>;
  snapshot: () => Promise<string>;
  createPairing: () => Promise<string>;
  pairGuest: (json: string) => Promise<string>;
  pickAndSend: (json: string) => Promise<string>;
  decide: (transferId: string, accepted: boolean) => Promise<string>;
};

const native = NativeModules.NexaShareModule as NativeEngine | undefined;

export default function App() {
  const [name, setName] = useState("Android phone");
  const [log, setLog] = useState("NexaShare Android MVP. Native TLS engine loads when the Kotlin module is present.");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("19529");
  const [code, setCode] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [fingerprint, setFingerprint] = useState("");
  const available = Boolean(native);

  const banner = useMemo(
    () =>
      available
        ? "Native module connected"
        : "Native module missing in this JS-only session. Install the debug APK on a device after JDK setup.",
    [available]
  );

  async function run(label: string, fn: () => Promise<string>): Promise<void> {
    try {
      if (!native) {
        setLog("Native module is not available in this environment.");
        return;
      }
      const result = await fn();
      setLog(`${label}: ${result}`);
    } catch (error) {
      setLog(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.brand}>NexaShare</Text>
        <Text style={styles.muted}>{banner}</Text>
        <TextInput style={styles.input} value={name} onChangeText={setName} accessibilityLabel="Device name" />
        <Pressable
          style={styles.button}
          onPress={() => run("start", () => native!.start(name))}
          accessibilityRole="button"
        >
          <Text style={styles.buttonLabel}>Start engine</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => run("snapshot", () => native!.snapshot())}>
          <Text style={styles.buttonLabel}>Refresh status</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => run("pairing", () => native!.createPairing())}>
          <Text style={styles.buttonLabel}>Create pairing code</Text>
        </Pressable>
        <Text style={styles.section}>Join a Windows PC</Text>
        <TextInput style={styles.input} value={host} onChangeText={setHost} placeholder="IP address" />
        <TextInput style={styles.input} value={port} onChangeText={setPort} placeholder="Port" keyboardType="numeric" />
        <TextInput style={styles.input} value={sessionId} onChangeText={setSessionId} placeholder="Pairing session ID" />
        <TextInput style={styles.input} value={code} onChangeText={setCode} placeholder="6-digit code" keyboardType="number-pad" />
        <TextInput style={styles.input} value={fingerprint} onChangeText={setFingerprint} placeholder="TLS fingerprint" />
        <Pressable
          style={styles.button}
          onPress={() =>
            run("pair", () =>
              native!.pairGuest(
                JSON.stringify({
                  host,
                  port: Number(port),
                  pairingSessionId: sessionId,
                  code,
                  expectedFingerprint: fingerprint
                })
              )
            )
          }
        >
          <Text style={styles.buttonLabel}>Pair</Text>
        </Pressable>
        <Pressable
          style={styles.button}
          onPress={() =>
            run("send", () =>
              native!.pickAndSend(JSON.stringify({ host, port: Number(port) }))
            )
          }
        >
          <Text style={styles.buttonLabel}>Pick files and send</Text>
        </Pressable>
        <View style={styles.log}>
          <Text style={styles.muted}>{log}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#101418" },
  wrap: { padding: 20, gap: 10 },
  brand: { color: "#e8eef4", fontSize: 28, fontWeight: "700" },
  muted: { color: "#93a0ae" },
  section: { color: "#e8eef4", marginTop: 12, fontWeight: "600" },
  input: {
    backgroundColor: "#171d23",
    color: "#e8eef4",
    borderRadius: 10,
    padding: 12
  },
  button: {
    backgroundColor: "#3d9a7a",
    borderRadius: 10,
    padding: 12,
    alignItems: "center"
  },
  buttonLabel: { color: "#07140f", fontWeight: "700" },
  log: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: "#171d23"
  }
});
