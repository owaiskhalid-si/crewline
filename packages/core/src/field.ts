// Shared by the field app and the tracking server.
import type { LatLng } from "./geo";
import type { Fix, GeofenceEvent, QueuedFix, Site } from "./tracking";

/** The point a distance and bearing away. */
export function offset(at: LatLng, meters: number, bearingDeg: number): LatLng {
  const b = (bearingDeg * Math.PI) / 180;
  return {
    lat: at.lat + (meters * Math.cos(b)) / 111_320,
    lng: at.lng + (meters * Math.sin(b)) / (111_320 * Math.cos((at.lat * Math.PI) / 180)),
  };
}

export type FieldJob = Site & { title: string; place: string; windowEnd: string; minutes: number };

/** Radius for arrival on the field app's demo jobs. */
export const FIELD_RADIUS_M = 60;

/**
 * Practice jobs placed around wherever the phone is, so anyone can try arrival detection on a
 * short walk, in any city. Nobody is really at these places.
 */
export function demoJobsAround(at: LatLng): FieldJob[] {
  const job = (id: string, meters: number, bearing: number, title: string, place: string, windowEnd: string, minutes: number): FieldJob => ({
    id,
    at: offset(at, meters, bearing),
    radiusM: FIELD_RADIUS_M,
    title,
    place,
    windowEnd,
    minutes,
  });
  return [
    job("near", 130, 40, "Furnace tune-up", "Just up the road", "In 30 min", 30),
    job("mid", 420, 130, "Thermostat swap", "A short walk away", "In 1 h", 25),
    job("far", 800, 250, "Water heater flush", "Around the corner", "In 2 h", 45),
  ];
}

/** Messages from a phone to the tracking server. */
export type DeviceMessage =
  | { type: "clock-in"; name: string }
  | { type: "fixes"; fixes: QueuedFix[] }
  | { type: "event"; event: GeofenceEvent; title: string }
  | { type: "clock-out" };

export type LiveDevice = { id: string; name: string; at: LatLng; accuracy: number; lastSeen: number; note: string };

/** Messages from the tracking server. */
export type ServerMessage =
  | { type: "ack"; seq: number }
  | { type: "devices"; devices: LiveDevice[] }
  | { type: "feed"; text: string; ts: number }
  | { type: "error"; message: string };

export type { Fix };
