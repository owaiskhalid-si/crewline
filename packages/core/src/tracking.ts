// Turning noisy phone GPS into trustworthy events. Used by the field app and the server.
import { distanceM, type LatLng } from "./geo";

export type Fix = LatLng & { accuracy: number; ts: number };

/** Fixes worse than this are too vague to act on. */
const MAX_ACCURACY_M = 75;
/** Faster than a car on a highway means a GPS jump, not a drive. */
const MAX_SPEED_MS = 45;

export type TrackFilter = { last: Fix | null; meters: number };

export const newFilter = (): TrackFilter => ({ last: null, meters: 0 });

/** Accepts a fix or rejects it as noise. Standing still doesn't add distance. */
export function acceptFix(filter: TrackFilter, fix: Fix): { filter: TrackFilter; accepted: boolean } {
  if (fix.accuracy > MAX_ACCURACY_M) return { filter, accepted: false };
  if (!filter.last) return { filter: { ...filter, last: fix }, accepted: true };
  if (fix.ts <= filter.last.ts) return { filter, accepted: false };
  const moved = distanceM(filter.last, fix);
  const seconds = (fix.ts - filter.last.ts) / 1000;
  if (moved / seconds > MAX_SPEED_MS) return { filter, accepted: false };
  const counts = moved > Math.max(fix.accuracy, 10);
  return {
    filter: counts ? { last: fix, meters: filter.meters + moved } : { ...filter, last: { ...filter.last, ts: fix.ts } },
    accepted: true,
  };
}

export type Site = { id: string; at: LatLng; radiusM: number };

export type GeofenceEvent = { type: "arrived" | "left"; siteId: string; ts: number };

export type GeofenceState = {
  inside: Record<string, boolean>;
  /** When each site's pending change was first seen. */
  pendingSince: Record<string, number>;
};

export const newGeofence = (): GeofenceState => ({ inside: {}, pendingSince: {} });

/** A stay this long counts as arrived, so driving past a customer doesn't. */
export const ARRIVE_DWELL_MS = 20_000;
const LEAVE_DWELL_MS = 30_000;
/** Leaving needs more distance than arriving, so GPS drift at the edge can't flap. */
const EXIT_FACTOR = 1.6;

export function updateGeofence(state: GeofenceState, sites: Site[], fix: Fix): { state: GeofenceState; events: GeofenceEvent[] } {
  if (fix.accuracy > MAX_ACCURACY_M) return { state, events: [] };
  const inside = { ...state.inside };
  const pendingSince = { ...state.pendingSince };
  const events: GeofenceEvent[] = [];
  for (const site of sites) {
    const d = distanceM(site.at, fix);
    const isIn = inside[site.id] ?? false;
    const wantsChange = isIn ? d > site.radiusM * EXIT_FACTOR : d <= site.radiusM;
    if (!wantsChange) {
      delete pendingSince[site.id];
      continue;
    }
    const since = pendingSince[site.id] ?? fix.ts;
    pendingSince[site.id] = since;
    if (fix.ts - since >= (isIn ? LEAVE_DWELL_MS : ARRIVE_DWELL_MS)) {
      inside[site.id] = !isIn;
      delete pendingSince[site.id];
      events.push({ type: isIn ? "left" : "arrived", siteId: site.id, ts: fix.ts });
    }
  }
  return { state: { inside, pendingSince }, events };
}

export type QueuedFix = Fix & { seq: number };

export type FixQueue = { nextSeq: number; items: QueuedFix[]; dropped: number };

export const newQueue = (): FixQueue => ({ nextSeq: 1, items: [], dropped: 0 });

/** Holds a shift's worth of fixes through a dead zone, dropping the oldest if it overflows. */
const MAX_QUEUED = 2000;

export function enqueue(queue: FixQueue, fix: Fix): FixQueue {
  const items = [...queue.items, { ...fix, seq: queue.nextSeq }];
  const overflow = Math.max(0, items.length - MAX_QUEUED);
  return { nextSeq: queue.nextSeq + 1, items: overflow ? items.slice(overflow) : items, dropped: queue.dropped + overflow };
}

/** Removes everything the server has confirmed. */
export function acknowledge(queue: FixQueue, upToSeq: number): FixQueue {
  return { ...queue, items: queue.items.filter((f) => f.seq > upToSeq) };
}

/** Keeps only fixes the server hasn't seen, so a retry after a dropped connection is harmless. */
export function newFixes(lastSeq: number, batch: QueuedFix[]): QueuedFix[] {
  return batch.filter((f) => f.seq > lastSeq).sort((a, b) => a.seq - b.seq);
}
