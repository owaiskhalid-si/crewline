// The field app's shift, as plain logic. Arrival detection runs on the phone, so it keeps working
// with no signal; the server only hears about it afterwards.
import {
  acceptFix, acknowledge, demoJobsAround, distanceM, enqueue, newFilter, newGeofence, newQueue, offset, updateGeofence,
  type FieldJob, type Fix, type FixQueue, type GeofenceEvent, type GeofenceState, type LatLng, type TrackFilter,
} from "@crewline/core";

export type Shift = {
  startedAt: number;
  jobs: FieldJob[];
  done: string[];
  here: string | null;
  filter: TrackFilter;
  geofence: GeofenceState;
  queue: FixQueue;
  /** Arrivals waiting to reach the server. */
  outbox: { event: GeofenceEvent; title: string }[];
  position: LatLng;
  accuracy: number;
};

export function startShift(at: LatLng, now: number): Shift {
  return { startedAt: now, jobs: demoJobsAround(at), done: [], here: null, filter: newFilter(), geofence: newGeofence(), queue: newQueue(), outbox: [], position: at, accuracy: 0 };
}

export const nextJob = (s: Shift): FieldJob | null => s.jobs.find((j) => !s.done.includes(j.id)) ?? null;

export type JobState = "done" | "here" | "next" | "later";

export function jobStates(s: Shift): { job: FieldJob; state: JobState; meters: number }[] {
  const next = nextJob(s);
  return s.jobs.map((job) => ({
    job,
    meters: distanceM(s.position, job.at),
    state: s.done.includes(job.id) ? "done" : s.here === job.id ? "here" : next?.id === job.id ? "next" : "later",
  }));
}

/** Handles one GPS fix. Returns the new shift and any arrival that just happened. */
export function applyFix(s: Shift, fix: Fix): { shift: Shift; arrived: FieldJob | null } {
  const { filter, accepted } = acceptFix(s.filter, fix);
  if (!accepted) return { shift: s, arrived: null };
  const open = s.jobs.filter((j) => !s.done.includes(j.id));
  const { state: geofence, events } = updateGeofence(s.geofence, open, fix);
  let here = s.here;
  let arrived: FieldJob | null = null;
  const outbox = [...s.outbox];
  for (const event of events) {
    const job = s.jobs.find((j) => j.id === event.siteId);
    if (!job) continue;
    if (event.type === "arrived") {
      here = job.id;
      arrived = job;
    } else if (here === job.id) {
      here = null;
    }
    outbox.push({ event, title: job.title });
  }
  return {
    shift: { ...s, filter, geofence, here, outbox, queue: enqueue(s.queue, fix), position: { lat: fix.lat, lng: fix.lng }, accuracy: fix.accuracy },
    arrived,
  };
}

export const finishJob = (s: Shift, id: string): Shift => ({ ...s, done: s.done.includes(id) ? s.done : [...s.done, id], here: s.here === id ? null : s.here });

export const confirmed = (s: Shift, seq: number): Shift => ({ ...s, queue: acknowledge(s.queue, seq) });

export const clearOutbox = (s: Shift): Shift => ({ ...s, outbox: [] });

/** The bearing and step for the practice walk, one fix a second. */
const WALK_MS = 9;

/** Where a practice walk goes next: toward the next job, then standing there until it counts. */
export function practiceStep(s: Shift, now: number): Fix | null {
  const job = nextJob(s);
  if (!job) return null;
  const left = distanceM(s.position, job.at);
  if (left <= job.radiusM * 0.5) return { ...s.position, accuracy: 8, ts: now };
  const bearing = (Math.atan2((job.at.lng - s.position.lng) * Math.cos((s.position.lat * Math.PI) / 180), job.at.lat - s.position.lat) * 180) / Math.PI;
  return { ...offset(s.position, Math.min(WALK_MS, left), bearing), accuracy: 8, ts: now };
}

export const fmtDistance = (meters: number) => (meters < 950 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`);
