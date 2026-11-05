import { distanceM, type FieldJob, type LatLng } from "@crewline/core";
import { StyleSheet, Text, View } from "react-native";

export type FieldMapProps = { position: LatLng; jobs: FieldJob[]; done: string[]; color: string; dark: boolean };

/** A plain radar for the browser build, which is only used to test the app without a phone. */
export function FieldMap({ position, jobs, done, color, dark }: FieldMapProps) {
  const size = 190;
  const scale = (size / 2 - 18) / Math.max(...jobs.map((j) => distanceM(position, j.at)), 1);
  const place = (at: LatLng) => {
    const metersEast = (at.lng - position.lng) * 111_320 * Math.cos((position.lat * Math.PI) / 180);
    const metersNorth = (at.lat - position.lat) * 111_320;
    return { left: size / 2 + metersEast * scale - 8, top: size / 2 - metersNorth * scale - 8 };
  };
  return (
    <View style={[styles.box, { height: size, backgroundColor: dark ? "#222A27" : "#E3E7E5" }]} accessibilityLabel="Your position and today's jobs">
      <View style={{ width: size, height: size }}>
        {jobs.map((job) => (
          <View key={job.id} style={[styles.pin, place(job.at), { borderColor: color, backgroundColor: done.includes(job.id) ? color : "#FFF" }]} />
        ))}
        <View style={[styles.me, { left: size / 2 - 9, top: size / 2 - 9 }]}>
          <Text style={styles.meText}>You</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: "100%", alignItems: "center", justifyContent: "center" },
  pin: { position: "absolute", width: 16, height: 16, borderRadius: 8, borderWidth: 4 },
  me: { position: "absolute", width: 18, height: 18, borderRadius: 9, backgroundColor: "#0E1412", borderWidth: 2, borderColor: "#FFF", alignItems: "center", justifyContent: "center" },
  meText: { position: "absolute", top: 18, width: 40, textAlign: "center", fontSize: 11, fontWeight: "700", color: "#47524E" },
});
