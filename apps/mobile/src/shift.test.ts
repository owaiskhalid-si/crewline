import { ARRIVE_DWELL_MS, distanceM } from "@crewline/core";
import { describe, expect, it } from "vitest";
import { applyFix, clearOutbox, confirmed, finishJob, fmtDistance, jobStates, nextJob, practiceStep, startShift, type Shift } from "./shift";

const HOME = { lat: 43.65, lng: -79.38 };
const T0 = 1_000_000;

function walkToArrival(shift: Shift, start = T0) {
  let s = shift;
  let now = start;
  let arrived = null;
  for (let i = 0; i < 400 && !arrived; i++) {
    now += 1000;
    const fix = practiceStep(s, now);
    if (!fix) break;
    const r = applyFix(s, fix);
    s = r.shift;
    arrived = r.arrived;
  }
  return { s, now, arrived };
}

describe("a shift", () => {
  it("starts with practice jobs around the phone, in walkable range", () => {
    const s = startShift(HOME, T0);
    expect(s.jobs).toHaveLength(3);
    for (const j of s.jobs) {
      expect(distanceM(HOME, j.at)).toBeGreaterThan(j.radiusM);
      expect(distanceM(HOME, j.at)).toBeLessThan(1000);
    }
    expect(nextJob(s)!.id).toBe("near");
  });
  it("marks arrival by itself after a real stay, with no server involved", () => {
    const { s, arrived } = walkToArrival(startShift(HOME, T0));
    expect(arrived!.id).toBe("near");
    expect(s.here).toBe("near");
    expect(s.outbox.map((o) => o.event.type)).toEqual(["arrived"]);
    expect(jobStates(s).map((x) => x.state)).toEqual(["here", "later", "later"]);
  });
  it("arrival takes a stay, so a passing fix doesn't count", () => {
    const s0 = startShift(HOME, T0);
    const job = s0.jobs[0];
    const r = applyFix(s0, { ...job.at, accuracy: 8, ts: T0 + 1000 });
    expect(r.arrived).toBeNull();
    const again = applyFix(r.shift, { ...job.at, accuracy: 8, ts: T0 + 1000 + ARRIVE_DWELL_MS });
    expect(again.arrived?.id).toBe(job.id);
  });
  it("moves on to the next job once one is finished", () => {
    const { s } = walkToArrival(startShift(HOME, T0));
    const after = finishJob(s, "near");
    expect(after.here).toBeNull();
    expect(nextJob(after)!.id).toBe("mid");
    expect(jobStates(after).map((x) => x.state)).toEqual(["done", "next", "later"]);
    expect(finishJob(after, "near").done).toEqual(["near"]);
  });
  it("can walk the whole day, then has nothing left", () => {
    let s = startShift(HOME, T0);
    let now = T0;
    for (const id of ["near", "mid", "far"]) {
      const r = walkToArrival(s, now);
      expect(r.arrived!.id).toBe(id);
      s = finishJob(r.s, id);
      now = r.now;
    }
    expect(nextJob(s)).toBeNull();
    expect(practiceStep(s, now + 1000)).toBeNull();
  });
  it("queues fixes through a dead zone and clears them once confirmed", () => {
    const { s } = walkToArrival(startShift(HOME, T0));
    expect(s.queue.items.length).toBeGreaterThan(10);
    const last = s.queue.items[s.queue.items.length - 1].seq;
    expect(confirmed(s, last).queue.items).toHaveLength(0);
    expect(confirmed(s, last - 2).queue.items).toHaveLength(2);
    expect(clearOutbox(s).outbox).toEqual([]);
  });
  it("ignores a wild GPS jump", () => {
    const s0 = applyFix(startShift(HOME, T0), { ...HOME, accuracy: 8, ts: T0 + 1000 }).shift;
    const r = applyFix(s0, { lat: 45, lng: -75, accuracy: 8, ts: T0 + 2000 });
    expect(r.shift.position.lat).toBe(HOME.lat);
    expect(r.shift.queue.items).toHaveLength(1);
  });
  it("formats distance for a glance", () => {
    expect(fmtDistance(134)).toBe("130 m");
    expect(fmtDistance(1600)).toBe("1.6 km");
  });
});
