// Who should take this job? Each candidate is tried by replaying their real forecast with the
// job added, so the answer accounts for the knock-on effect on the rest of their day.
import { buildDay, DEPOT, forecast, legBetween, techAt } from "./day";
import { fmtClock } from "./geo";
import type { Job, Plan, Tech } from "./types";

export type Candidate = {
  tech: Tech;
  /** Where in their route the job would go. */
  insertAt: number;
  arriveAt: number;
  minutesLate: number;
  /** Extra late minutes this causes on their other jobs. */
  knockOnLate: number;
  driveMinutes: number;
  score: number;
  why: string;
};

export type Ranking = { job: Job; candidates: Candidate[]; ruledOut: { tech: Tech; reason: string }[] };

/** The first place in a route that hasn't started: nobody is pulled off a job or turned around. */
export function firstOpenSlot(plan: Plan, tech: Tech, t: number): number {
  const day = buildDay(plan, tech);
  let slot = 0;
  for (const stop of day.stops) {
    if (t >= stop.departAt) slot++;
    else break;
  }
  return slot;
}

export function withAssignment(plan: Plan, jobId: string, techId: string, insertAt: number, t: number): Plan {
  const routes: Plan["routes"] = {};
  for (const [id, jobs] of Object.entries(plan.routes)) routes[id] = jobs.filter((j) => j !== jobId);
  const route = [...(routes[techId] ?? [])];
  route.splice(Math.min(insertAt, route.length), 0, jobId);
  routes[techId] = route;
  return { ...plan, routes, jobs: plan.jobs.map((j) => (j.id === jobId ? { ...j, assignedAt: t } : j)) };
}

const lateSum = (plan: Plan, tech: Tech, t: number, skip?: string) =>
  forecast(buildDay(plan, tech), t).reduce((sum, f) => (f.state === "done" || f.stop.job.id === skip ? sum : sum + f.minutesLate), 0);

export function rankTechnicians(plan: Plan, jobId: string, t: number): Ranking | null {
  const job = plan.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const candidates: Candidate[] = [];
  const ruledOut: Ranking["ruledOut"] = [];
  const currentOwner = Object.entries(plan.routes).find(([, jobs]) => jobs.includes(jobId))?.[0];

  for (const tech of plan.techs) {
    if (tech.id === currentOwner) continue;
    if (!tech.skills.includes(job.skill)) {
      ruledOut.push({ tech, reason: `Doesn't do ${job.skill}` });
      continue;
    }
    if (t >= tech.shiftEnd) {
      ruledOut.push({ tech, reason: "Shift has ended" });
      continue;
    }
    const before = lateSum(plan, tech, t);
    const insertAt = firstOpenSlot(plan, tech, t);
    const trial = withAssignment(plan, jobId, tech.id, insertAt, t);
    const stop = forecast(buildDay(trial, tech), t).find((f) => f.stop.job.id === jobId);
    if (!stop) continue;
    if (stop.startAt + job.plannedMinutes > tech.shiftEnd) {
      ruledOut.push({ tech, reason: `Couldn't finish before ${fmtClock(tech.shiftEnd)}` });
      continue;
    }
    const knockOnLate = Math.max(0, lateSum(trial, tech, t, jobId) - before);
    const minutesLate = stop.minutesLate;
    // Being late to this job and making others late both count; urgent calls also reward speed.
    const score = minutesLate * 3 + knockOnLate * 2 + (stop.arriveAt - t) * (job.urgent ? 1 : 0.3);
    candidates.push({
      tech,
      insertAt,
      arriveAt: stop.arriveAt,
      minutesLate,
      knockOnLate,
      driveMinutes: stop.stop.leg.minutes,
      score,
      why: explain(stop.arriveAt, minutesLate, knockOnLate),
    });
  }
  candidates.sort((a, b) => a.score - b.score);
  return { job, candidates, ruledOut };
}

function explain(arriveAt: number, minutesLate: number, knockOnLate: number): string {
  const when = `Can be there by ${fmtClock(arriveAt)}`;
  const lateness = minutesLate > 0 ? `, ${Math.round(minutesLate)} min past the window` : "";
  const rest = knockOnLate > 0 ? `. Makes other jobs ${Math.round(knockOnLate)} min later` : ". No other job runs late";
  return `${when}${lateness}${rest}.`;
}

export type CustomerStage = "scheduled" | "next" | "on-the-way" | "here" | "done" | "unassigned";

export type CustomerView = {
  stage: CustomerStage;
  title: string;
  place: string;
  windowStart: number;
  windowEnd: number;
  techName: string | null;
  etaMinutes: number | null;
  /** Only while the technician is driving to this customer, and never otherwise. */
  position: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number };
};

/**
 * What a customer's tracking link may show. It's built field by field so nothing else about
 * the crew can leak: no other jobs, no other customers, no position except on the way here.
 */
export function customerView(plan: Plan, jobId: string, t: number): CustomerView | null {
  const job = plan.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const base = { title: job.title, place: job.place, windowStart: job.windowStart, windowEnd: job.windowEnd, destination: job.at };
  const techId = Object.entries(plan.routes).find(([, jobs]) => jobs.includes(jobId))?.[0];
  const tech = plan.techs.find((x) => x.id === techId);
  if (!tech) return { ...base, stage: "unassigned", techName: null, etaMinutes: null, position: null };

  const day = buildDay(plan, tech);
  const stops = forecast(day, t);
  const mine = stops.find((f) => f.stop.job.id === jobId);
  if (!mine) return { ...base, stage: "unassigned", techName: null, etaMinutes: null, position: null };

  if (mine.state === "done") return { ...base, stage: "done", techName: tech.name, etaMinutes: null, position: null };
  if (t >= mine.stop.arriveAt) return { ...base, stage: "here", techName: tech.name, etaMinutes: 0, position: null };
  const eta = Math.max(1, Math.round(mine.arriveAt - t));
  if (t >= mine.stop.departAt) {
    return { ...base, stage: "on-the-way", techName: tech.name, etaMinutes: eta, position: techAt(plan, day, t).position };
  }
  const index = stops.indexOf(mine);
  const isNext = index === 0 || stops[index - 1].state === "done" || stops[index - 1].state === "active";
  return { ...base, stage: isNext ? "next" : "scheduled", techName: tech.name, etaMinutes: isNext ? eta : null, position: null };
}

export { DEPOT, legBetween };
