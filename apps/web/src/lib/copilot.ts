// The dispatch copilot. Tools run in the browser against the live board; the server only holds
// the API key and makes one model call per request. It suggests, and the dispatcher decides:
// nothing is assigned until a person presses Assign.
import { boardAt, buildDay, fmtClock, forecast, rankTechnicians, techAt, unassignedJobs, type Plan, type Ranking } from "@crewline/core";

export const TOOL_DECLARATIONS = [
  { name: "get_board", description: "The crew right now: time, who's on shift, what each person is doing, jobs done, at-risk jobs and unassigned calls.", parametersJsonSchema: { type: "object", properties: {} } },
  { name: "rank_technicians", description: "Ranks who should take a job by replaying each person's day with it added. Use for any 'who should take' question.", parametersJsonSchema: { type: "object", properties: { job_id: { type: "string", description: "A job id from get_board or find_job." } }, required: ["job_id"] } },
  { name: "technician_day", description: "One technician's stops today, with forecast arrival times and risk.", parametersJsonSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
  { name: "find_job", description: "Finds jobs by place or title, with their ids and owners.", parametersJsonSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
] as const;

export const TOOL_LABELS: Record<string, string> = {
  get_board: "Read the board",
  rank_technicians: "Replayed each technician's day",
  technician_day: "Checked a technician's stops",
  find_job: "Looked up the job",
};

export type ToolOutput = { result: Record<string, unknown>; ranking?: Ranking };

export function runTool(plan: Plan, t: number, name: string, args: Record<string, unknown> = {}): ToolOutput {
  const now = fmtClock(t);
  switch (name) {
    case "get_board": {
      const b = boardAt(plan, t);
      return {
        result: {
          now,
          on_shift: b.onShift,
          jobs_done: b.done,
          jobs_total: b.total,
          technicians: b.techs.map((x) => ({ name: x.tech.name, status: x.status, jobs_done: x.doneCount, no_signal_minutes: x.noSignalFor === null ? undefined : Math.round(x.noSignalFor), current_job: x.stop?.job.title })),
          at_risk: b.atRisk.map((r) => ({ job_id: r.forecast.stop.job.id, title: r.forecast.stop.job.title, place: r.forecast.stop.job.place, technician: r.tech.name, risk: r.forecast.risk, forecast_arrival: fmtClock(r.forecast.arriveAt), window_end: fmtClock(r.forecast.stop.job.windowEnd), minutes_late: Math.round(r.forecast.minutesLate) })),
          unassigned: unassignedJobs(plan, t).map((j) => ({ job_id: j.id, title: j.title, place: j.place, skill: j.skill, urgent: !!j.urgent, window_end: fmtClock(j.windowEnd) })),
        },
      };
    }
    case "rank_technicians": {
      const ranking = rankTechnicians(plan, String(args.job_id ?? ""), t);
      if (!ranking) return { result: { error: "No job with that id. Use find_job or get_board first." } };
      return {
        ranking,
        result: {
          now,
          job: { title: ranking.job.title, place: ranking.job.place, window_end: fmtClock(ranking.job.windowEnd) },
          options: ranking.candidates.map((c, i) => ({ rank: i + 1, name: c.tech.name, can_arrive: fmtClock(c.arriveAt), minutes_past_window: Math.round(c.minutesLate), later_customers_delayed_minutes: Math.round(c.knockOnLate), summary: c.why })),
          ruled_out: ranking.ruledOut.map((r) => ({ name: r.tech.name, reason: r.reason })),
        },
      };
    }
    case "technician_day": {
      const query = String(args.name ?? "").trim().toLowerCase();
      const tech = plan.techs.find((x) => x.name.toLowerCase() === query);
      if (!tech) return { result: { error: `No technician called ${args.name}. The crew is ${plan.techs.map((x) => x.name).join(", ")}.` } };
      const state = techAt(plan, buildDay(plan, tech), t);
      return {
        result: {
          now,
          name: tech.name,
          status: state.status,
          no_signal_minutes: state.noSignalFor === null ? undefined : Math.round(state.noSignalFor),
          skills: tech.skills,
          shift_ends: fmtClock(tech.shiftEnd),
          stops: forecast(buildDay(plan, tech), t).map((f) => ({ place: f.stop.job.place, title: f.stop.job.title, state: f.state, arrival: fmtClock(f.arriveAt), expected_finish: fmtClock(f.endAt), window_end: fmtClock(f.stop.job.windowEnd), risk: f.risk })),
        },
      };
    }
    case "find_job": {
      // Every word must match, so "no-heat call in Cabbagetown" and "no heat" both find it.
      const words = String(args.query ?? "").toLowerCase().split(/[^a-z0-9.]+/).filter((w) => w.length > 1 && w !== "call" && w !== "job" && w !== "in" && w !== "the");
      const visible = plan.jobs.filter((j) => (j.createdAt ?? 0) <= t);
      const hits = words.length
        ? visible
            .filter((j) => {
              const own = `${j.place} ${j.title}`.toLowerCase();
              return words.every((w) => own.includes(w));
            })
            .sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent))
        : [];
      return {
        result: {
          jobs: hits.slice(0, 6).map((j) => ({
            job_id: j.id,
            title: j.title,
            place: j.place,
            window_end: fmtClock(j.windowEnd),
            technician: plan.techs.find((x) => plan.routes[x.id]?.includes(j.id))?.name ?? null,
          })),
        },
      };
    }
    default:
      return { result: { error: `Unknown tool ${name}` } };
  }
}

const TIME = /\b([01]?\d|2[0-3]):[0-5]\d\b/g;

function collect(value: unknown, out: Set<string>) {
  if (typeof value === "string") out.add(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collect(v, out));
}

/** Every clock time and every crew name in a reply must trace back to what the tools returned. */
export function checkReply(text: string, plan: Plan, results: unknown[], userTexts: string[]) {
  const known = new Set<string>();
  results.forEach((r) => collect(r, known));
  const normal = (v: string) => v.padStart(5, "0");
  const knownTimes = new Set([...known].filter((k) => /^\d\d:\d\d$/.test(k)));
  for (const u of userTexts) for (const m of u.matchAll(TIME)) knownTimes.add(normal(m[0]));
  const times = [...text.matchAll(TIME)].map((m) => normal(m[0]));
  const unverifiedTimes = times.filter((v) => !knownTimes.has(v));
  // A crew member mentioned in the reply but absent from every tool result wasn't checked.
  const all = JSON.stringify(results);
  const unverifiedNames = plan.techs.map((x) => x.name).filter((n) => new RegExp(`\\b${n}\\b`).test(text) && !all.includes(`"${n}"`));
  return { unverifiedTimes, unverifiedNames };
}

export type Part = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: { name: string; response: Record<string, unknown>; id?: string } };
export type Content = { role: "user" | "model"; parts: Part[] };

export type Reply = { text: string; steps: string[]; ranking?: Ranking; mode: "live" | "offline"; unverified: string[] };
export type Turn = { role: "user" | "model"; text: string };

type Post = (body: { contents: Content[]; now: string; allowTools: boolean }) => Promise<{ parts: Part[] } | null>;

const postToServer: Post = async (body) => {
  const res = await fetch("/api/copilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.ok ? ((await res.json()) as { parts: Part[] }) : null;
};

const MAX_ROUNDS = 5;

export async function askCopilot(history: Turn[], question: string, plan: Plan, t: number, onStep: (s: string) => void = () => {}, post: Post = postToServer): Promise<Reply> {
  const contents: Content[] = [...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })), { role: "user", parts: [{ text: question }] }];
  const steps: string[] = [];
  const results: unknown[] = [];
  let ranking: Ranking | undefined;
  const fallback = (): Reply => ({ ...offlineCopilot(question, plan, t), mode: "offline", unverified: [] });

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const turn = await post({ contents, now: fmtClock(t), allowTools: round < MAX_ROUNDS - 1 });
      if (!turn) return fallback();
      const calls = turn.parts.filter((p) => p.functionCall);
      if (calls.length === 0) {
        const text = turn.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
        if (!text) return fallback();
        const { unverifiedTimes, unverifiedNames } = checkReply(text, plan, results, [...history.filter((h) => h.role === "user").map((h) => h.text), question]);
        return { text, steps, ranking, mode: "live", unverified: [...unverifiedTimes, ...unverifiedNames] };
      }
      // The model's parts go back untouched: they carry its thought signatures.
      contents.push({ role: "model", parts: turn.parts });
      const responses: Part[] = [];
      for (const part of calls) {
        const call = part.functionCall!;
        const out = runTool(plan, t, call.name, call.args);
        if (out.ranking) ranking = out.ranking;
        results.push(out.result);
        const label = TOOL_LABELS[call.name];
        if (label && !steps.includes(label)) {
          steps.push(label);
          onStep(label);
        }
        responses.push({ functionResponse: { name: call.name, response: out.result, ...(call.id ? { id: call.id } : {}) } });
      }
      contents.push({ role: "user", parts: responses });
    }
    return fallback();
  } catch {
    return fallback();
  }
}

/** The job most words in the question point to, so "the Cabbagetown no-heat call" finds that call. */
function matchJob(plan: Plan, q: string, t: number) {
  const words = q.split(/[^a-z]+/).filter((w) => w.length > 2 && !FILLER.has(w));
  let best: { job: Plan["jobs"][number]; score: number } | null = null;
  for (const job of plan.jobs) {
    if ((job.createdAt ?? 0) > t) continue;
    const own = new Set(`${job.title} ${job.place}`.toLowerCase().split(/[^a-z]+/));
    // Whole words only, and a tie goes to the urgent call.
    const score = words.filter((w) => own.has(w)).length + (job.urgent ? 0.5 : 0);
    if (score >= 1 && (!best || score > best.score)) best = { job, score };
  }
  return best?.job ?? null;
}

const FILLER = new Set(["who", "should", "take", "the", "call", "assign", "send", "this", "job", "for", "and", "can", "get", "what", "about"]);

/** Plain rules for when the model can't be reached, so the demo never dead-ends. */
export function offlineCopilot(question: string, plan: Plan, t: number): { text: string; steps: string[]; ranking?: Ranking } {
  const q = question.toLowerCase();
  const b = boardAt(plan, t);
  const steps = [TOOL_LABELS.get_board];
  if (/\b(who|take|assign|send|urgent|call)\b/.test(q)) {
    const job = b.unassigned[0] ?? matchJob(plan, q, t);
    if (job) {
      const owner = plan.techs.find((x) => plan.routes[x.id]?.includes(job.id));
      if (owner) return { text: `${owner.name} already has ${job.title.toLowerCase()} in ${job.place}.`, steps: [...steps, TOOL_LABELS.find_job] };
      const ranking = rankTechnicians(plan, job.id, t);
      const top = ranking?.candidates[0];
      if (ranking && top) {
        return { text: `${top.tech.name} is the best fit for ${job.title.toLowerCase()} in ${job.place}. ${top.why}`, steps: [...steps, TOOL_LABELS.rank_technicians], ranking };
      }
      return { text: `Nobody on shift can take ${job.title.toLowerCase()} today.`, steps };
    }
    if (!plan.techs.some((x) => q.includes(x.name.toLowerCase()))) return { text: "There's no open call to place right now.", steps };
  }
  const tech = plan.techs.find((x) => new RegExp(`\\b${x.name.toLowerCase()}\\b`).test(q));
  if (tech) {
    const now = b.techs.find((x) => x.tech.id === tech.id)!;
    const next = b.forecasts[tech.id]?.find((f) => f.state !== "done");
    return { text: `${tech.name} is ${now.status === "off" ? "off shift" : now.status}, with ${now.doneCount} jobs done.${next ? ` Next is ${next.stop.job.place}, about ${fmtClock(next.arriveAt)}.` : " Nothing else is booked today."}`, steps: [...steps, TOOL_LABELS.technician_day] };
  }
  if (b.atRisk.length) {
    const r = b.atRisk[0];
    return { text: `${b.atRisk.length} ${b.atRisk.length === 1 ? "job is" : "jobs are"} at risk. The worst is ${r.forecast.stop.job.place}: ${r.tech.name} should arrive about ${fmtClock(r.forecast.arriveAt)}, and the window ends ${fmtClock(r.forecast.stop.job.windowEnd)}.`, steps };
  }
  return { text: `It's ${fmtClock(t)}. ${b.done} of ${b.total} jobs are done, ${b.onShift} people are on shift, and nothing is at risk.`, steps };
}
