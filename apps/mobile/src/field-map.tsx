import type { FieldJob, LatLng } from "@crewline/core";
import { StyleSheet } from "react-native";
import MapView, { Circle, Marker } from "react-native-maps";

export type FieldMapProps = { position: LatLng; jobs: FieldJob[]; done: string[]; color: string; dark: boolean };

/** Phones get a real map. The web build, used only for testing, has field-map.web.tsx instead. */
export function FieldMap({ position, jobs, done, color }: FieldMapProps) {
  return (
    <MapView
      style={styles.map}
      showsUserLocation
      region={{ latitude: position.lat, longitude: position.lng, latitudeDelta: 0.018, longitudeDelta: 0.018 }}
      accessibilityLabel="Map of your position and today's jobs"
    >
      {jobs.map((job) => (
        <Marker key={job.id} coordinate={{ latitude: job.at.lat, longitude: job.at.lng }} title={job.title} description={job.place} opacity={done.includes(job.id) ? 0.4 : 1} pinColor={color} />
      ))}
      {jobs
        .filter((job) => !done.includes(job.id))
        .map((job) => (
          <Circle key={`${job.id}-area`} center={{ latitude: job.at.lat, longitude: job.at.lng }} radius={job.radiusM} strokeColor={color} fillColor={`${color}22`} />
        ))}
    </MapView>
  );
}

const styles = StyleSheet.create({ map: { height: 190, width: "100%" } });
