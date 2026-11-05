import { describe, expect, it } from "vitest";
import {
  acceptFix, acknowledge, ARRIVE_DWELL_MS, boardAt, buildDay, customerView, decodePolyline, DEMO_START, distanceM, enqueue, eventsUpTo, firstOpenSlot, fmtClock, forecast,
  gridPath, newFilter, newFixes, newGeofence, newQueue, pathLengthM, pathUpTo, pointAlong, rankTechnicians, seedPlan, techAt, TECHS, trailAt, unassignedJobs, updateGeofence, URGENT_JOB_ID, withAssignment,
  type Fix,
} from "./index";

const A = { lat: 43.65, lng: -79.38 };
const B = { lat: 43.66, lng: -79.38 };

describe("geo", () => {
  it("measures distance", () => {
    expect(distanceM(A, B)).toBeCloseTo(1112, -1);
    expect(distanceM(A, A)).toBe(0);
  });
  it("finds points along a path by distance, not by vertex", () => {
    const path = [A, B, { lat: 43.67, lng: -79.38 }];
    expect(pointAlong(path, 0)).toEqual(A);
    expect(pointAlong(path, 1)).toEqual(path[2]);
    expect(pointAlong(path, 0.5).lat).toBeCloseTo(43.66, 4);
    expect(pathLengthM(pathUpTo(path, 0.25))).toBeCloseTo(pathLengthM(path) / 4, 0);
  });
  it("decodes a polyline", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
  });
  it("draws estimated routes with one street corner, ending at the destination", () => {
    const path = gridPath(A, { lat: 43.67, lng: -79.34 });
    expect(path).toHaveLength(3);
    expect(path[2]).toEqual({ lat: 43.67, lng: -79.34 });
  });
  it("formats clock times", () => {
    expect(fmtClock(690)).toBe("11:30");
    expect(fmtClock(485.6)).toBe("08:06");
  });
});

describe("the day", () => {
  const plan = seedPlan();
  const sam = TECHS[0];
  const day = buildDay(plan, sam);

  it("has a real road route for every planned leg", () => {
    for (const t of TECHS) for (const s of buildDay(plan, t).stops) expect(s.leg.estimated).toBe(false);
  });
  it("waits for a window to open, and runs stops in order", () => {
    for (const s of day.stops) {
      expect(s.startAt).toBeGreaterThanOrEqual(s.job.windowStart);
      expect(s.endAt).toBe(s.startAt + s.job.actualMinutes);
    }
    for (let i = 1; i < day.stops.length; i++) expect(day.stops[i].departAt).toBe(day.stops[i - 1].endAt);
  });
  it("tracks status through the day", () => {
    const s = day.stops[1];
    expect(techAt(plan, day, sam.shiftStart - 5).status).toBe("off");
    expect(techAt(plan, day, (s.departAt + s.arriveAt) / 2).status).toBe("driving");
    expect(techAt(plan, day, s.startAt + 1).status).toBe("working");
    expect(techAt(plan, day, sam.shiftEnd + 1).status).toBe("off");
  });
  it("moves along the road while driving and sits on site while working", () => {
    const s = day.stops[1];
    const mid = techAt(plan, day, (s.departAt + s.arriveAt) / 2);
    expect(distanceM(mid.position, s.job.at)).toBeGreaterThan(50);
    expect(techAt(plan, day, s.startAt + 1).position).toEqual(s.job.at);
  });
  it("counts kilometres only as they're driven", () => {
    const s = day.stops[1];
    const before = techAt(plan, day, s.departAt).metersToday;
    const during = techAt(plan, day, (s.departAt + s.arriveAt) / 2).metersToday;
    expect(during - before).toBeCloseTo(s.leg.meters / 2, 0);
  });
  it("freezes the position during a signal gap and says how long", () => {
    const amara = TECHS.find((t) => t.id === "amara")!;
    const d = buildDay(plan, amara);
    const gap = amara.signalGaps![0];
    const inside = techAt(plan, d, gap.from + 10);
    expect(inside.noSignalFor).toBe(10);
    expect(inside.position).toEqual(techAt(plan, d, gap.from).position);
    expect(techAt(plan, d, gap.to + 1).noSignalFor).toBeNull();
  });
  it("draws the trail so far", () => {
    expect(trailAt(plan, day, sam.shiftStart)).toHaveLength(0);
    expect(trailAt(plan, day, day.stops[2].endAt).length).toBeGreaterThan(5);
  });
  it("logs events up to now, newest first, with nothing from the future", () => {
    const days = TECHS.map((t) => buildDay(plan, t));
    const events = eventsUpTo(plan, days, DEMO_START);
    expect(events.every((e) => e.at <= DEMO_START)).toBe(true);
    expect(events[0].at).toBeGreaterThanOrEqual(events[events.length - 1].at);
    expect(eventsUpTo(plan, days, 600).some((e) => e.kind === "call")).toBe(false);
    expect(eventsUpTo(plan, days, 720).some((e) => e.kind === "call")).toBe(true);
  });
});

describe("forecast", () => {
  const plan = seedPlan();
  const sam = TECHS[0];
  const day = buildDay(plan, sam);
  const boiler = day.stops[2];
  const next = "sam-4";

  it("treats finished work as fact", () => {
    const f = forecast(day, boiler.endAt + 1)[2];
    expect(f.state).toBe("done");
    expect(f.endAt).toBe(boiler.endAt);
  });
  it("doesn't know about an overrun before it happens", () => {
    const early = forecast(day, boiler.startAt + 5);
    expect(early[2].endAt).toBe(boiler.startAt + boiler.job.plannedMinutes);
    expect(early[3].risk).toBe("fine");
  });
  it("sees the next job slip once the overrun has begun", () => {
    const late = forecast(day, boiler.startAt + boiler.job.plannedMinutes + 40);
    const f = late.find((x) => x.stop.job.id === next)!;
    expect(f.risk).not.toBe("fine");
    expect(f.arriveAt).toBeGreaterThan(forecast(day, boiler.startAt + 5)[3].arriveAt);
  });
  it("assumes a longer overrun has longer left to run", () => {
    const plannedEnd = boiler.startAt + boiler.job.plannedMinutes;
    const remaining = (over: number) => forecast(day, plannedEnd + over)[2].endAt - (plannedEnd + over);
    expect(remaining(2)).toBe(5);
    expect(remaining(40)).toBe(20);
  });
  it("records real lateness on completed stops", () => {
    const end = forecast(day, 1000).find((x) => x.stop.job.id === next)!;
    expect(end.minutesLate).toBe(Math.max(0, end.stop.arriveAt - end.stop.job.windowEnd));
  });
});

describe("the board", () => {
  const plan = seedPlan();
  it("opens with a story: the crew is out and the urgent call isn't in yet", () => {
    const b = boardAt(plan, DEMO_START);
    expect(b.onShift).toBe(8);
    expect(b.done).toBeGreaterThan(0);
    expect(b.done).toBeLessThan(b.total);
    expect(b.unassigned).toHaveLength(0);
    expect(b.techs.some((t) => t.status === "driving")).toBe(true);
  });
  it("shows the urgent call when it comes in", () => {
    expect(unassignedJobs(plan, 700).map((j) => j.id)).toEqual([URGENT_JOB_ID]);
    expect(boardAt(plan, 700).total).toBe(boardAt(plan, 699).total + 1);
  });
  it("catches at least one job at risk during the day", () => {
    const risky = [660, 690, 720, 750, 780].some((t) => boardAt(plan, t).atRisk.length > 0);
    expect(risky).toBe(true);
  });
  it("lists the worst risk first", () => {
    for (let t = 480; t < 1020; t += 30) {
      const late = boardAt(plan, t).atRisk.map((r) => r.forecast.minutesLate);
      expect(late).toEqual([...late].sort((a, b) => b - a));
    }
  });
  it("never produces a broken value at any minute of the day", () => {
    for (let t = 460; t <= 1040; t += 7) {
      const b = boardAt(plan, t);
      for (const x of b.techs) {
        expect(Number.isFinite(x.position.lat)).toBe(true);
        expect(Number.isFinite(x.metersToday)).toBe(true);
      }
      expect(b.done).toBeLessThanOrEqual(b.total);
    }
  });
});

describe("dispatch", () => {
  const plan = seedPlan();
  const t = 702;

  it("only offers technicians with the right skill", () => {
    const r = rankTechnicians(plan, URGENT_JOB_ID, t)!;
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) expect(c.tech.skills).toContain("heating");
    expect(r.ruledOut.find((x) => x.tech.id === "priya")?.reason).toMatch(/heating/);
  });
  it("orders candidates by score and explains each one", () => {
    const r = rankTechnicians(plan, URGENT_JOB_ID, t)!;
    const scores = r.candidates.map((c) => c.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    for (const c of r.candidates) expect(c.why).toMatch(/Can be there by \d\d:\d\d/);
  });
  it("doesn't just pick the closest: Sam is nearest but would make his next customer late", () => {
    const r = rankTechnicians(plan, URGENT_JOB_ID, t)!;
    const sam = r.candidates.find((c) => c.tech.id === "sam")!;
    expect(sam.knockOnLate).toBeGreaterThan(0);
    expect(sam.why).toMatch(/other jobs \d+ min later/);
    expect(Math.min(...r.candidates.map((c) => c.arriveAt))).toBe(sam.arriveAt);
    expect(r.candidates[0].tech.id).not.toBe("sam");
    expect(r.candidates[0].knockOnLate).toBe(0);
  });
  it("never pulls someone off a job or turns them around", () => {
    for (const tech of TECHS) {
      const slot = firstOpenSlot(plan, tech, t);
      const stops = buildDay(plan, tech).stops;
      expect(stops.slice(0, slot).every((s) => s.departAt <= t)).toBe(true);
      expect(stops.slice(slot).every((s) => s.departAt > t)).toBe(true);
    }
  });
  it("assigning changes nothing that has already happened", () => {
    const c = rankTechnicians(plan, URGENT_JOB_ID, t)!.candidates[0];
    const next = withAssignment(plan, URGENT_JOB_ID, c.tech.id, c.insertAt, t);
    const before = buildDay(plan, c.tech).stops.filter((s) => s.departAt <= t);
    const after = buildDay(next, c.tech).stops;
    before.forEach((s, i) => expect(after[i].endAt).toBe(s.endAt));
    expect(unassignedJobs(next, t)).toHaveLength(0);
    expect(after.some((s) => s.job.id === URGENT_JOB_ID)).toBe(true);
    expect(after.find((s) => s.job.id === URGENT_JOB_ID)!.departAt).toBeGreaterThanOrEqual(t);
  });
  it("moves an existing job without duplicating it", () => {
    const next = withAssignment(plan, "sam-5", "omar", 99, t);
    expect(next.routes.sam).not.toContain("sam-5");
    expect(next.routes.omar).toContain("sam-5");
    expect(Object.values(next.routes).flat().filter((j) => j === "sam-5")).toHaveLength(1);
    expect(rankTechnicians(plan, "sam-5", t)!.candidates.every((c) => c.tech.id !== "sam")).toBe(true);
  });
  it("won't offer anyone who couldn't finish before their shift ends", () => {
    const r = rankTechnicians(plan, URGENT_JOB_ID, 1015)!;
    expect(r.candidates).toHaveLength(0);
    expect(r.ruledOut.length).toBe(TECHS.length);
  });
  it("returns nothing for an unknown job", () => {
    expect(rankTechnicians(plan, "nope", t)).toBeNull();
  });
});

describe("the customer link", () => {
  const plan = seedPlan();
  const day = buildDay(plan, TECHS[0]);
  const s = day.stops[3];
  const id = s.job.id;

  it("moves through the stages", () => {
    expect(customerView(plan, id, 500)!.stage).toBe("scheduled");
    const onWay = customerView(plan, id, (s.departAt + s.arriveAt) / 2)!;
    expect(onWay.stage).toBe("on-the-way");
    expect(onWay.etaMinutes).toBeGreaterThan(0);
    expect(customerView(plan, id, s.arriveAt + 1)!.stage).toBe("here");
    expect(customerView(plan, id, s.endAt + 1)!.stage).toBe("done");
  });
  it("shows a position only while the technician is on the way to this customer", () => {
    expect(customerView(plan, id, 500)!.position).toBeNull();
    expect(customerView(plan, id, s.departAt - 1)!.position).toBeNull();
    expect(customerView(plan, id, (s.departAt + s.arriveAt) / 2)!.position).not.toBeNull();
    expect(customerView(plan, id, s.arriveAt + 1)!.position).toBeNull();
    expect(customerView(plan, id, s.endAt + 1)!.position).toBeNull();
  });
  it("carries nothing about other customers or jobs", () => {
    const json = JSON.stringify(customerView(plan, id, (s.departAt + s.arriveAt) / 2));
    for (const other of plan.jobs) {
      if (other.id === id) continue;
      expect(json).not.toContain(other.customer);
    }
    expect(json).not.toContain(s.job.customer); // not even their own name
  });
  it("copes with an unassigned or unknown job", () => {
    expect(customerView(plan, URGENT_JOB_ID, 705)!.stage).toBe("unassigned");
    expect(customerView(plan, "nope", 705)).toBeNull();
  });
});

const fix = (lat: number, lng: number, ts: number, accuracy = 10): Fix => ({ lat, lng, ts, accuracy });

describe("GPS filter", () => {
  it("ignores vague fixes and impossible jumps", () => {
    let f = newFilter();
    f = acceptFix(f, fix(A.lat, A.lng, 1000)).filter;
    expect(acceptFix(f, fix(B.lat, B.lng, 2000, 500)).accepted).toBe(false);
    expect(acceptFix(f, fix(B.lat, B.lng, 3000)).accepted).toBe(false); // 1.1 km in 2 s
    expect(acceptFix(f, fix(A.lat, A.lng, 500)).accepted).toBe(false); // older than the last
  });
  it("adds distance when moving, not when standing still with drift", () => {
    let f = newFilter();
    f = acceptFix(f, fix(A.lat, A.lng, 0)).filter;
    for (let i = 1; i <= 20; i++) f = acceptFix(f, fix(A.lat + 0.00003 * (i % 2), A.lng, i * 5000)).filter;
    expect(f.meters).toBe(0);
    f = acceptFix(f, fix(B.lat, B.lng, 200_000)).filter;
    expect(f.meters).toBeCloseTo(1112, -1);
  });
});

describe("geofence", () => {
  const site = { id: "job", at: A, radiusM: 100 };
  const near = (offsetDeg: number, ts: number, accuracy = 10) => fix(A.lat + offsetDeg, A.lng, ts, accuracy);
  const run = (fixes: Fix[]) => {
    let state = newGeofence();
    const events = [];
    for (const f of fixes) {
      const r = updateGeofence(state, [site], f);
      state = r.state;
      events.push(...r.events);
    }
    return events;
  };
  it("marks arrival only after a real stay", () => {
    expect(run([near(0.0001, 0), near(0.0001, ARRIVE_DWELL_MS - 1)])).toEqual([]);
    expect(run([near(0.0001, 0), near(0.0001, ARRIVE_DWELL_MS)])).toEqual([{ type: "arrived", siteId: "job", ts: ARRIVE_DWELL_MS }]);
  });
  it("doesn't count driving past", () => {
    expect(run([near(0.0001, 0), near(0.01, 5000), near(0.0001, 25_000), near(0.01, 30_000)])).toEqual([]);
  });
  it("doesn't flap when GPS drifts around the edge", () => {
    const events = run([near(0.0005, 0), near(0.0005, 25_000), near(0.00105, 30_000), near(0.00105, 40_000), near(0.0012, 50_000), near(0.0005, 60_000)]);
    expect(events.filter((e) => e.type === "arrived")).toHaveLength(1);
    expect(events.filter((e) => e.type === "left")).toHaveLength(0);
  });
  it("marks leaving after moving well away", () => {
    const events = run([near(0, 0), near(0, 25_000), near(0.01, 30_000), near(0.01, 65_000)]);
    expect(events.map((e) => e.type)).toEqual(["arrived", "left"]);
  });
  it("ignores vague fixes", () => {
    expect(run([near(0, 0, 200), near(0, 30_000, 200)])).toEqual([]);
  });
});

describe("offline queue", () => {
  it("keeps fixes in order and clears what the server confirmed", () => {
    let q = newQueue();
    for (let i = 0; i < 5; i++) q = enqueue(q, fix(A.lat, A.lng, i));
    expect(q.items.map((f) => f.seq)).toEqual([1, 2, 3, 4, 5]);
    q = acknowledge(q, 3);
    expect(q.items.map((f) => f.seq)).toEqual([4, 5]);
    expect(enqueue(q, fix(A.lat, A.lng, 9)).items.at(-1)!.seq).toBe(6);
  });
  it("drops the oldest rather than growing forever", () => {
    let q = newQueue();
    for (let i = 0; i < 2010; i++) q = enqueue(q, fix(A.lat, A.lng, i));
    expect(q.items).toHaveLength(2000);
    expect(q.dropped).toBe(10);
    expect(q.items[0].seq).toBe(11);
  });
  it("makes a retried batch harmless on the server", () => {
    const batch = [{ ...fix(A.lat, A.lng, 1), seq: 3 }, { ...fix(A.lat, A.lng, 2), seq: 4 }, { ...fix(A.lat, A.lng, 3), seq: 2 }];
    expect(newFixes(3, batch).map((f) => f.seq)).toEqual([4]);
    expect(newFixes(0, batch).map((f) => f.seq)).toEqual([2, 3, 4]);
  });
});



