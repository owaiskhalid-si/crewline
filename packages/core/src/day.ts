// A technician's day, worked out from the plan. The whole demo is a pure function of
// (plan, time), which is what makes scrubbing back through the day possible.
import { distanceM, gridPath, pathLengthM, pathUpTo, pointAlong, type LatLng } from "./geo";
import type { Job, Plan, Tech } from "./types";

/** City driving, used only when no real route is known yet. */
const ROAD_FACTOR = 1.35;
const AVERAGE_KMH = 26;
export const DEPOT = "depot";

export type Leg = { path: LatLng[]; minutes: number; meters: number; estimated: boolean };

export function legBetween(plan: Plan, fromId: string, toId: string, from: LatLng, to: LatLng): Leg {
  const known = plan.legs[`${fromId}>${toId}`];
  if (known) return { path: known.path, minutes: known.minutes, meters: pathLengthM(known.path), estimated: false };
  const meters = distanceM(from, to) * ROAD_FACTOR;
  return { path: gridPath(from, to), minutes: Math.max(3, (meters / 1000 / AVERAGE_KMH) * 60), meters, estimated: true };
}

export type Stop = {
  job: Job;
  leg: Leg;
  departAt: number;
  arriveAt: number;
  startAt: number;
  endAt: number;
};

export type Day = { tech: Tech; stops: Stop[]; finishedAt: number };

const jobById = (plan: Plan, id: string) => plan.jobs.find((j) => j.id === id);

export function buildDay(plan: Plan, tech: Tech): Day {
  const stops: Stop[] = [];
  let clock = tech.shiftStart;
  let fromId = DEPOT;
  let from = plan.depot;
  for (const id of plan.routes[tech.id] ?? []) {
    const job = jobById(plan, id);
    if (!job) continue;
    const leg = legBetween(plan, fromId, job.id, from, job.at);
    const departAt = Math.max(clock, job.assignedAt ?? 0);
    const arriveAt = departAt + leg.minutes;
    const startAt = Math.max(arriveAt, job.urgent ? arriveAt : job.windowStart);
    const endAt = startAt + job.actualMinutes;
    stops.push({ job, leg, departAt, arriveAt, startAt, endAt });
    clock = endAt;
    fromId = job.id;
    from = job.at;
  }
  return { tech, stops, finishedAt: clock };
}

export const buildDays = (plan: Plan): Day[] => plan.techs.map((t) => buildDay(plan, t));

export type Status = "off" | "driving" | "waiting" | "working" | "free";

export type TechNow = {
  tech: Tech;
  status: Status;
  position: LatLng;
  /** Where they have driven so far on the current leg, for the map. */
  stop: Stop | null;
  legShare: number;
  noSignalFor: number | null;
  metersToday: number;
  doneCount: number;
};

function rawPosition(plan: Plan, day: Day, t: number): { status: Status; position: LatLng; stop: Stop | null; legShare: number } {
  const { tech, stops } = day;
  if (t < tech.shiftStart || t > tech.shiftEnd) return { status: "off", position: plan.depot, stop: null, legShare: 0 };
  let position = plan.depot;
  for (const stop of stops) {
    if (t < stop.departAt) return { status: position === plan.depot && stop === stops[0] ? "waiting" : "free", position, stop: null, legShare: 0 };
    if (t < stop.arriveAt) {
      const legShare = (t - stop.departAt) / (stop.arriveAt - stop.departAt);
      return { status: "driving", position: pointAlong(stop.leg.path, legShare), stop, legShare };
    }
    if (t < stop.startAt) return { status: "waiting", position: stop.job.at, stop, legShare: 1 };
    if (t < stop.endAt) return { status: "working", position: stop.job.at, stop, legShare: 1 };
    position = stop.job.at;
  }
  return { status: "free", position, stop: null, legShare: 1 };
}

export function techAt(plan: Plan, day: Day, t: number): TechNow {
  const raw = rawPosition(plan, day, t);
  // During a signal gap the map keeps the last known position and says how old it is.
  const gap = day.tech.signalGaps?.find((g) => t >= g.from && t < g.to);
  const position = gap ? rawPosition(plan, day, gap.from).position : raw.position;
  let metersToday = 0;
  let doneCount = 0;
  for (const s of day.stops) {
    if (t >= s.arriveAt) metersToday += s.leg.meters;
    else if (t > s.departAt) metersToday += s.leg.meters * ((t - s.departAt) / (s.arriveAt - s.departAt));
    if (t >= s.endAt) doneCount++;
  }
  return { tech: day.tech, ...raw, position, noSignalFor: gap ? t - gap.from : null, metersToday, doneCount };
}

export type Risk = "fine" | "tight" | "late";

/** Close enough to the end of a window that a dispatcher should look. */
const TIGHT_MINUTES = 12;

export type StopState = "done" | "active" | "upcoming";

export type StopForecast = {
  stop: Stop;
  state: StopState;
  /** Best estimate of arrival: the real time once it has happened. */
  arriveAt: number;
  startAt: number;
  endAt: number;
  risk: Risk;
  minutesLate: number;
};

/**
 * What a dispatcher can know at time t. Finished work is fact. Everything ahead is a forecast
 * from the planned job length, so an overrun only shows once the job has actually overrun.
 */
export function forecast(day: Day, t: number): StopForecast[] {
  const out: StopForecast[] = [];
  let clock = Math.max(t, day.tech.shiftStart);
  for (const stop of day.stops) {
    if (t >= stop.endAt) {
      const minutesLate = Math.max(0, stop.arriveAt - stop.job.windowEnd);
      out.push({ stop, state: "done", arriveAt: stop.arriveAt, startAt: stop.startAt, endAt: stop.endAt, risk: minutesLate > 0 ? "late" : "fine", minutesLate });
      clock = Math.max(t, stop.endAt);
      continue;
    }
    let arriveAt: number;
    let startAt: number;
    let endAt: number;
    let state: StopState = "upcoming";
    if (t >= stop.startAt) {
      state = "active";
      arriveAt = stop.arriveAt;
      startAt = stop.startAt;
      // A job past its planned length rarely ends right away: the longer the overrun so far,
      // the longer we assume is left. Never earlier than the plan said.
      const plannedEnd = startAt + stop.job.plannedMinutes;
      const overrun = Math.max(0, t - plannedEnd);
      endAt = t > plannedEnd ? t + Math.max(5, overrun * 0.5) : plannedEnd;
    } else if (t >= stop.departAt) {
      state = "active";
      arriveAt = stop.arriveAt;
      startAt = Math.max(arriveAt, stop.job.urgent ? arriveAt : stop.job.windowStart);
      endAt = startAt + stop.job.plannedMinutes;
    } else {
      const departAt = Math.max(clock, stop.job.assignedAt ?? 0);
      arriveAt = departAt + stop.leg.minutes;
      startAt = Math.max(arriveAt, stop.job.urgent ? arriveAt : stop.job.windowStart);
      endAt = startAt + stop.job.plannedMinutes;
    }
    const minutesLate = Math.max(0, arriveAt - stop.job.windowEnd);
    const risk: Risk = minutesLate > 0 ? "late" : stop.job.windowEnd - arriveAt <= TIGHT_MINUTES && t < stop.arriveAt ? "tight" : "fine";
    out.push({ stop, state, arriveAt, startAt, endAt, risk, minutesLate });
    clock = endAt;
  }
  return out;
}

/** Everything already driven today, for drawing the trail behind a technician. */
export function trailAt(plan: Plan, day: Day, t: number): LatLng[] {
  const out: LatLng[] = [];
  for (const s of day.stops) {
    if (t >= s.arriveAt) out.push(...s.leg.path);
    else if (t > s.departAt) out.push(...pathUpTo(s.leg.path, (t - s.departAt) / (s.arriveAt - s.departAt)));
    else break;
  }
  return out;
}

export type DayEvent = { at: number; techId: string | null; kind: "clock-in" | "left" | "arrived" | "finished" | "call" | "clock-out"; text: string; late?: boolean };

/** The day's log up to time t, newest first. */
export function eventsUpTo(plan: Plan, days: Day[], t: number): DayEvent[] {
  const events: DayEvent[] = [];
  for (const day of days) {
    const name = day.tech.name;
    events.push({ at: day.tech.shiftStart, techId: day.tech.id, kind: "clock-in", text: `${name} clocked in` });
    for (const s of day.stops) {
      events.push({ at: s.departAt, techId: day.tech.id, kind: "left", text: `${name} left for ${s.job.place}` });
      const late = s.arriveAt > s.job.windowEnd;
      events.push({ at: s.arriveAt, techId: day.tech.id, kind: "arrived", text: `${name} arrived at ${s.job.place}`, late });
      events.push({ at: s.endAt, techId: day.tech.id, kind: "finished", text: `${name} finished ${s.job.title.toLowerCase()}` });
    }
  }
  for (const j of plan.jobs) {
    if (j.createdAt !== undefined) events.push({ at: j.createdAt, techId: null, kind: "call", text: `New call: ${j.title.toLowerCase()} in ${j.place}` });
  }
  return events.filter((e) => e.at <= t).sort((a, b) => b.at - a.at);
}

export function unassignedJobs(plan: Plan, t: number): Job[] {
  const given = new Set(Object.values(plan.routes).flat());
  return plan.jobs.filter((j) => !given.has(j.id) && (j.createdAt ?? 0) <= t);
}

/** Calls that haven't come in yet are invisible, so replaying the morning stays honest. */
export const jobVisible = (job: Job, t: number) => (job.createdAt ?? 0) <= t;

export type Board = {
  t: number;
  days: Day[];
  techs: TechNow[];
  forecasts: Record<string, StopForecast[]>;
  atRisk: { tech: Tech; forecast: StopForecast }[];
  unassigned: Job[];
  onShift: number;
  done: number;
  total: number;
  metersToday: number;
};

export function boardAt(plan: Plan, t: number): Board {
  const days = buildDays(plan);
  const techs = days.map((d) => techAt(plan, d, t));
  const forecasts: Record<string, StopForecast[]> = {};
  const atRisk: Board["atRisk"] = [];
  let done = 0;
  let total = 0;
  for (const day of days) {
    const f = forecast(day, t).filter((x) => jobVisible(x.stop.job, t));
    forecasts[day.tech.id] = f;
    for (const x of f) {
      total++;
      if (x.state === "done") done++;
      else if (x.risk !== "fine") atRisk.push({ tech: day.tech, forecast: x });
    }
  }
  atRisk.sort((a, b) => b.forecast.minutesLate - a.forecast.minutesLate || a.forecast.arriveAt - b.forecast.arriveAt);
  const unassigned = unassignedJobs(plan, t);
  return {
    t,
    days,
    techs,
    forecasts,
    atRisk,
    unassigned,
    onShift: techs.filter((x) => x.status !== "off").length,
    done,
    total: total + unassigned.length,
    metersToday: techs.reduce((s, x) => s + x.metersToday, 0),
  };
}
