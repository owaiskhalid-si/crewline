import { Overpass_400Regular } from "@expo-google-fonts/overpass/400Regular";
import { Overpass_600SemiBold } from "@expo-google-fonts/overpass/600SemiBold";
import { Overpass_800ExtraBold } from "@expo-google-fonts/overpass/800ExtraBold";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { memo, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View, type TextStyle } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { FieldMap } from "./field-map";
import { fmtDistance, jobStates, nextJob, type JobState } from "./shift";
import { useShift, type LinkState } from "./use-shift";

const LIGHT = { page: "#EEF1F0", panel: "#FBFCFB", sunk: "#E3E7E5", ink: "#0E1412", ink2: "#47524E", ink3: "#6B7773", hair: "rgba(14,20,18,0.14)", cta: "#0E1412", onCta: "#FBFCFB", good: "#0B7A48", late: "#CF2317" };
const DARK = { page: "#0D1211", panel: "#151B19", sunk: "#222A27", ink: "#EDF1EF", ink2: "#B4BFBB", ink3: "#8D9994", hair: "rgba(237,241,239,0.15)", cta: "#EDF1EF", onCta: "#0D1211", good: "#4CD593", late: "#FF6D60" };
type C = typeof LIGHT;

/** A field worker's own line, in the colour of Line 1 on the dispatch board. */
const LINE = "#E5352B";

const F = { body: "Overpass_400Regular", semi: "Overpass_600SemiBold", bold: "Overpass_800ExtraBold" };

function T({ v = "body", color, style, children, ...rest }: { v?: keyof typeof TYPE; color?: string; style?: TextStyle; children: React.ReactNode; accessibilityRole?: "header"; numberOfLines?: number }) {
  return (
    <Text {...rest} style={[TYPE[v], color ? { color } : null, style]}>
      {children}
    </Text>
  );
}

const TYPE = {
  hero: { fontFamily: F.bold, fontSize: 34, lineHeight: 39 },
  title: { fontFamily: F.bold, fontSize: 22, lineHeight: 27 },
  strong: { fontFamily: F.semi, fontSize: 16, lineHeight: 22 },
  body: { fontFamily: F.body, fontSize: 16, lineHeight: 23 },
  small: { fontFamily: F.body, fontSize: 14, lineHeight: 20 },
  smallStrong: { fontFamily: F.semi, fontSize: 14, lineHeight: 20 },
} satisfies Record<string, TextStyle>;

function Button({ label, onPress, c, kind = "primary", disabled }: { label: string; onPress: () => void; c: C; kind?: "primary" | "quiet"; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.button, { backgroundColor: kind === "primary" ? c.cta : c.sunk, opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}
    >
      <T v="strong" color={kind === "primary" ? c.onCta : c.ink}>{label}</T>
    </Pressable>
  );
}

/** In development the tracking server is usually on the same computer as the Expo server. */
function defaultServer(): string {
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return host ? `ws://${host}:3710` : Platform.OS === "web" && typeof location !== "undefined" ? `ws://${location.hostname}:3710` : "";
}

function Welcome({ c, onStart, starting, problem, name, setName, server, setServer }: { c: C; onStart: () => void; starting: boolean; problem: string | null; name: string; setName: (v: string) => void; server: string; setServer: (v: string) => void }) {
  const insets = useSafeAreaInsets();
  const [showServer, setShowServer] = useState(false);
  return (
    <ScrollView style={{ backgroundColor: c.page }} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.pad, { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.brand}>
        <View style={[styles.bullet, { backgroundColor: c.cta, width: 30, height: 30, borderRadius: 15 }]}><T v="smallStrong" color={c.onCta}>C</T></View>
        <T v="strong">Crewline</T>
      </View>
      <T v="hero" accessibilityRole="header" style={styles.gapL}>Your day, one line at a time.</T>
      <T color={c.ink2} style={styles.gapS}>Clock in to see your jobs. Arrivals mark themselves, so there&apos;s less to tap.</T>

      <T v="smallStrong" color={c.ink2} style={styles.gapL}>Your first name</T>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Alex"
        placeholderTextColor={c.ink3}
        autoCapitalize="words"
        maxLength={30}
        accessibilityLabel="Your first name"
        style={[styles.input, { backgroundColor: c.sunk, color: c.ink }]}
      />

      <View style={[styles.card, { backgroundColor: c.panel, borderColor: c.hair }]}>
        <T v="strong">What your dispatcher sees</T>
        <T v="small" color={c.ink2} style={styles.gapXS}>Your location and arrival times, only between clock-in and clock-out.</T>
        <T v="strong" style={styles.gapM}>What nobody sees</T>
        <T v="small" color={c.ink2} style={styles.gapXS}>Anything when you&apos;re off shift. Clocking out erases your location from the server.</T>
      </View>

      {problem && <T v="small" color={c.late} style={styles.gapM}>{problem}</T>}

      <View style={styles.gapL}>
        <Button c={c} label={starting ? "Starting" : "Clock in"} onPress={onStart} disabled={starting || !name.trim()} />
      </View>

      <Pressable onPress={() => setShowServer((v) => !v)} accessibilityRole="button" style={styles.gapM}>
        <T v="small" color={c.ink3}>{showServer ? "Hide" : "Show"} the tracking server address</T>
      </Pressable>
      {showServer && (
        <TextInput
          value={server}
          onChangeText={setServer}
          placeholder="ws://192.168.1.20:3710"
          placeholderTextColor={c.ink3}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Tracking server address"
          style={[styles.input, { backgroundColor: c.sunk, color: c.ink, marginTop: 6 }]}
        />
      )}
      <T v="small" color={c.ink3} style={styles.gapM}>A demo. The jobs are practice ones placed near you, and nobody is really there.</T>
    </ScrollView>
  );
}

const LINK_TEXT: Record<LinkState, string> = {
  none: "Not connected to a server. Everything still works on this phone.",
  connecting: "Connecting to dispatch",
  connected: "Connected to dispatch",
  offline: "No connection. Saving on this phone, and it'll catch up.",
};

const StopRow = memo(function StopRow({ title, place, meters, state, last, c }: { title: string; place: string; meters: number; state: JobState; last: boolean; c: C }) {
  const filled = state === "done" || state === "here";
  return (
    <View style={styles.stop}>
      <View style={styles.rail}>
        {!last && <View style={[styles.railLine, { backgroundColor: LINE, opacity: state === "done" ? 1 : 0.28 }]} />}
        <View style={[styles.station, { borderColor: LINE, backgroundColor: filled ? LINE : c.panel }]} />
      </View>
      <View style={styles.stopText}>
        <T v="strong" numberOfLines={1} color={state === "done" ? c.ink3 : c.ink}>{title}</T>
        <T v="small" color={state === "here" ? c.good : c.ink3}>{state === "done" ? "Finished" : state === "here" ? "You're here. Marked automatically." : `${place}, ${fmtDistance(meters)}`}</T>
      </View>
    </View>
  );
});

function openDirections(at: { lat: number; lng: number }) {
  const destination = `${at.lat},${at.lng}`;
  const url = Platform.OS === "ios" ? `maps:?daddr=${destination}` : Platform.OS === "android" ? `google.navigation:q=${destination}` : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  void Linking.openURL(url).catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination}`));
}

function ShiftScreen({ c, dark, name, api }: { c: C; dark: boolean; name: string; api: ReturnType<typeof useShift> }) {
  const insets = useSafeAreaInsets();
  const { shift, link, walking, setWalking, clockOut, finish, problem } = api;
  const [confirming, setConfirming] = useState(false);
  const rows = useMemo(() => (shift ? jobStates(shift) : []), [shift]);
  if (!shift) return null;
  const next = nextJob(shift);
  const here = rows.find((r) => r.state === "here");
  const nextRow = rows.find((r) => r.state === "next");
  const waiting = shift.queue.items.length;

  return (
    <ScrollView style={{ backgroundColor: c.page }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false}>
      <View style={[styles.head, { backgroundColor: c.panel, borderBottomColor: c.hair, paddingTop: insets.top + 12 }]}>
        <View style={styles.headRow}>
          <View style={[styles.bullet, { backgroundColor: LINE, width: 32, height: 32, borderRadius: 16 }]}><T v="strong" color="#FFF">{name.slice(0, 1).toUpperCase()}</T></View>
          <View style={styles.flex}>
            <T v="strong">{name}, on shift</T>
            <View style={styles.sharing}>
              <View style={[styles.dot, { backgroundColor: c.good }]} />
              <T v="small" color={c.ink2}>Sharing your location</T>
            </View>
          </View>
        </View>
      </View>

      <FieldMap position={shift.position} jobs={shift.jobs} done={shift.done} color={LINE} dark={dark} />

      <View style={styles.pad}>
        {here ? (
          <>
            <T v="title" accessibilityRole="header">{here.job.title}</T>
            <T color={c.good} style={styles.gapXS}>You&apos;ve arrived. Nothing to tap.</T>
            <View style={styles.gapM}><Button c={c} label="Finish this job" onPress={() => finish(here.job.id)} /></View>
          </>
        ) : next && nextRow ? (
          <>
            <T v="small" color={c.ink3}>Next</T>
            <T v="title" accessibilityRole="header">{next.title}</T>
            <T color={c.ink2} style={styles.gapXS}>{fmtDistance(nextRow.meters)} away. Window ends: {next.windowEnd.toLowerCase()}.</T>
            <View style={styles.gapM}><Button c={c} label="Get directions" onPress={() => openDirections(next.at)} /></View>
          </>
        ) : (
          <>
            <T v="title" accessibilityRole="header">All done for today.</T>
            <T color={c.ink2} style={styles.gapXS}>Clock out when you&apos;re finished, and your location is erased.</T>
          </>
        )}

        <View style={styles.gapL}>
          <T v="strong" accessibilityRole="header">Today&apos;s line</T>
          <View style={styles.gapS}>
            {rows.map((r, i) => <StopRow key={r.job.id} title={r.job.title} place={r.job.place} meters={r.meters} state={r.state} last={i === rows.length - 1} c={c} />)}
          </View>
        </View>

        {next && (
          <View style={[styles.card, { backgroundColor: c.panel, borderColor: c.hair }]}>
            <T v="strong">Try it without walking</T>
            <T v="small" color={c.ink2} style={styles.gapXS}>Moves you to the next job at a fast walk, using made-up GPS, so you can watch arrival mark itself.</T>
            <View style={styles.gapS}><Button c={c} kind="quiet" label={walking ? "Stop the practice walk" : "Start a practice walk"} onPress={() => setWalking(!walking)} /></View>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: c.panel, borderColor: c.hair }]}>
          <T v="strong">What&apos;s being shared</T>
          <T v="small" color={c.ink2} style={styles.gapXS}>Your dispatcher sees your location and arrivals until you clock out. {Platform.OS === "web" ? "" : "In this version, sharing pauses when the app isn't open."}</T>
          <T v="small" color={link === "connected" ? c.good : c.ink3} style={styles.gapS}>{LINK_TEXT[link]}</T>
          {waiting > 0 && link !== "connected" && <T v="small" color={c.ink3}>{waiting} location {waiting === 1 ? "update" : "updates"} waiting to send.</T>}
          <T v="small" color={c.ink3}>Moved {fmtDistance(shift.filter.meters)} this shift.</T>
        </View>

        {problem && <T v="small" color={c.late} style={styles.gapM}>{problem}</T>}

        <View style={styles.gapL}>
          {confirming ? (
            <>
              <T v="small" color={c.ink2}>This stops sharing and erases your location from the server.</T>
              <View style={styles.gapS}><Button c={c} label="Yes, clock out" onPress={clockOut} /></View>
              <View style={styles.gapS}><Button c={c} kind="quiet" label="Stay on shift" onPress={() => setConfirming(false)} /></View>
            </>
          ) : (
            <Button c={c} kind="quiet" label="Clock out" onPress={() => setConfirming(true)} />
          )}
        </View>
      </View>
    </ScrollView>
  );
}

function Root() {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  const c = dark ? DARK : LIGHT;
  const [name, setName] = useState("");
  const [server, setServer] = useState(defaultServer);
  const api = useShift(name.trim(), server.trim());

  // Remembers the name on this phone, and nowhere else.
  useEffect(() => {
    void AsyncStorage.getItem("crewline-name").then((v) => {
      if (v) setName(v);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (name) void AsyncStorage.setItem("crewline-name", name).catch(() => {});
  }, [name]);

  return (
    <View style={[styles.flex, { backgroundColor: c.page }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      {api.shift ? (
        <ShiftScreen c={c} dark={dark} name={name.trim()} api={api} />
      ) : (
        <Welcome c={c} onStart={() => void api.clockIn()} starting={api.starting} problem={api.problem} name={name} setName={setName} server={server} setServer={setServer} />
      )}
    </View>
  );
}

export default function App() {
  const [loaded, failed] = useFonts({ Overpass_400Regular, Overpass_600SemiBold, Overpass_800ExtraBold });
  if (!loaded && !failed) return <View style={{ flex: 1, backgroundColor: "#0E1412" }} />;
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pad: { paddingHorizontal: 20, paddingTop: 20 },
  brand: { flexDirection: "row", alignItems: "center", gap: 10 },
  bullet: { alignItems: "center", justifyContent: "center" },
  gapXS: { marginTop: 3 },
  gapS: { marginTop: 8 },
  gapM: { marginTop: 14 },
  gapL: { marginTop: 22 },
  input: { height: 50, borderRadius: 10, paddingHorizontal: 14, fontSize: 16, fontFamily: F.body, marginTop: 6 },
  card: { marginTop: 20, padding: 16, borderRadius: 12, borderWidth: 1 },
  button: { height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  head: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth * 2 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  sharing: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  stop: { flexDirection: "row", gap: 12, minHeight: 58 },
  rail: { width: 24, alignItems: "center" },
  railLine: { position: "absolute", top: 12, bottom: -12, width: 6, borderRadius: 3 },
  station: { width: 22, height: 22, borderRadius: 11, borderWidth: 4 },
  stopText: { flex: 1, minWidth: 0 },
});
