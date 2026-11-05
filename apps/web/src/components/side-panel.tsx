"use client";

import { fmtClock, rankTechnicians, type Board, type DayEvent, type Job, type Plan, type StopForecast, type Tech, type TechNow } from "@crewline/core";
import { useMemo, useState } from "react";
import type { LiveCrew } from "@/lib/use-devices";

const STATUS: Record<TechNow["status"], string> = { off: "Off shift", driving: "Driving", waiting: "Waiting for the window", working: "On a job", free: "Free" };

export const Bullet = ({ tech, size = 26 }: { tech: Pick<Tech, "line" | "color">; size?: number }) => (
  <span className="bullet" style={{ background: tech.color, width: size, height: size, fontSize: size * 0.54 }}>{tech.line}</span>
);

function RiskText({ f }: { f: StopForecast }) {
  if (f.risk === "late") return <span className="font-bold text-late">{Math.round(f.minutesLate)} min late</span>;
  if (f.risk === "tight") return <span className="font-bold text-tight">Tight</span>;
  return null;
}

export function Attention({ board, events, onJob, onTech, live }: { board: Board; events: DayEvent[]; onJob: (id: string) => void; onTech: (id: string) => void; live: LiveCrew }) {
  const clear = board.unassigned.length === 0 && board.atRisk.length === 0;
  const stale = board.techs.filter((x) => x.noSignalFor !== null);
  return (
    <div className="flex flex-col gap-5">
      {(live.devices.length > 0 || live.feed.length > 0) && (
        <section aria-label="Live phones">
          <h2 className="text-[15px] font-extrabold">Live phones</h2>
          {live.devices.length === 0 && <p className="text-[14px] text-ink-2">Nobody is clocked in on a phone right now.</p>}
          {live.devices.map((d) => (
            <p key={d.id} className="mt-1 flex items-center gap-2.5 text-[14px]">
              <span className="bullet bg-ink text-page" style={{ width: 24, height: 24, fontSize: 13 }}>{d.name.slice(0, 1).toUpperCase()}</span>
              <span><b>{d.name}</b>: {d.note}</span>
            </p>
          ))}
          <ul className="mt-1.5 flex flex-col gap-1">
            {live.feed.slice(0, 4).map((f) => <li key={`${f.ts}${f.text}`} className="text-[13px] leading-snug text-ink-2">{f.text}</li>)}
          </ul>
        </section>
      )}
      {board.unassigned.map((job) => (
        <button key={job.id} type="button" onClick={() => onJob(job.id)} className="rounded-lg bg-late p-4 text-left text-white hover:opacity-90 dark:text-[#0d1211]">
          <span className="block text-[13px] font-bold">New call, needs a technician</span>
          <span className="mt-1 block text-xl leading-tight font-extrabold">{job.title}</span>
          <span className="mt-1 block text-[14px]">{job.place}, by {fmtClock(job.windowEnd)}. Find the best technician.</span>
        </button>
      ))}

      {clear && stale.length === 0 && <p className="text-[15px] text-ink-2">Every job is on time. Nothing needs you right now.</p>}

      {board.atRisk.length > 0 && (
        <section>
          <h2 className="text-[15px] font-extrabold">At risk</h2>
          <ul className="mt-1 divide-y divide-hair">
            {board.atRisk.map(({ tech, forecast: f }) => (
              <li key={f.stop.job.id}>
                <button type="button" onClick={() => onJob(f.stop.job.id)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-sunk">
                  <Bullet tech={tech} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold">{f.stop.job.place}</span>
                    <span className="block truncate text-[13px] text-ink-2">{tech.name} arrives about {fmtClock(f.arriveAt)}, window ends {fmtClock(f.stop.job.windowEnd)}</span>
                  </span>
                  <span className="shrink-0 text-[13px]"><RiskText f={f} /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {stale.length > 0 && (
        <section>
          <h2 className="text-[15px] font-extrabold">No signal</h2>
          {stale.map((x) => (
            <button key={x.tech.id} type="button" onClick={() => onTech(x.tech.id)} className="mt-1 flex w-full items-center gap-3 py-1.5 text-left hover:bg-sunk">
              <Bullet tech={x.tech} />
              <span className="text-[14px] text-ink-2">{x.tech.name}: last seen {Math.round(x.noSignalFor!)} min ago. The map shows that spot, not a guess.</span>
            </button>
          ))}
        </section>
      )}

      <section>
        <h2 className="text-[15px] font-extrabold">Today so far</h2>
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {events.slice(0, 7).map((e, i) => (
            <li key={`${e.at}${e.text}${i}`} className="flex gap-3 text-[14px] leading-snug">
              <span className="w-11 shrink-0 font-semibold text-ink-3">{fmtClock(e.at)}</span>
              <span className={e.late ? "font-semibold text-late" : e.kind === "call" ? "font-semibold" : "text-ink-2"}>{e.text}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function TechDetail({ tech, board, onJob }: { tech: TechNow; board: Board; onJob: (id: string) => void }) {
  const stops = board.forecasts[tech.tech.id] ?? [];
  return (
    <div>
      <div className="flex items-center gap-3">
        <Bullet tech={tech.tech} size={40} />
        <div>
          <h2 className="text-2xl leading-none font-extrabold">{tech.tech.name}</h2>
          <p className="mt-1 text-[14px] text-ink-2">{STATUS[tech.status]}{tech.noSignalFor !== null ? `, no signal for ${Math.round(tech.noSignalFor)} min` : ""}</p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[13px] text-ink-3">
        <div><dd className="text-xl font-extrabold text-ink">{tech.doneCount}/{stops.length}</dd><dt>Jobs done</dt></div>
        <div><dd className="text-xl font-extrabold text-ink">{(tech.metersToday / 1000).toFixed(1)}</dd><dt>km driven</dt></div>
        <div><dd className="text-xl font-extrabold text-ink">{fmtClock(tech.tech.shiftEnd)}</dd><dt>Shift ends</dt></div>
      </dl>
      <p className="mt-3 text-[13px] capitalize text-ink-3">{tech.tech.skills.join(", ")}</p>

      {/* The same line as the board, turned on its side. */}
      <ol className="relative mt-4">
        <span className="absolute top-3 bottom-3 left-[9px] w-[5px] rounded-full opacity-40" style={{ background: tech.tech.color }} aria-hidden="true" />
        {stops.map((f) => (
          <li key={f.stop.job.id}>
            <button type="button" onClick={() => onJob(f.stop.job.id)} className="relative flex w-full items-start gap-3 rounded-md py-2 text-left hover:bg-sunk">
              <span
                className="z-10 mt-0.5 size-[23px] shrink-0 rounded-full border-[4px]"
                style={{
                  borderColor: f.risk === "late" ? "var(--late)" : f.risk === "tight" ? "var(--tight)" : tech.tech.color,
                  background: f.state === "done" ? tech.tech.color : "var(--panel)",
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex justify-between gap-2">
                  <span className="truncate text-[15px] font-bold">{f.stop.job.place}</span>
                  <span className="shrink-0 text-[14px] font-semibold text-ink-2">{fmtClock(f.arriveAt)}</span>
                </span>
                <span className="flex justify-between gap-2 text-[13px] text-ink-2">
                  <span className="truncate">{f.stop.job.title}</span>
                  <RiskText f={f} />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function JobDetail({ job, plan, board, onAssign, trackHref }: { job: Job; plan: Plan; board: Board; onAssign: (jobId: string, c: { insertAt: number; tech: Tech }) => void; trackHref: string }) {
  const owner = board.days.find((d) => d.stops.some((s) => s.job.id === job.id));
  const forecast = owner ? board.forecasts[owner.tech.id]?.find((f) => f.stop.job.id === job.id) : undefined;
  const open = !forecast || forecast.state === "upcoming";
  // Ranking replays each person's day, so it only runs while the choice is open.
  const roundedT = Math.round(board.t);
  const ranking = useMemo(() => (open ? rankTechnicians(plan, job.id, roundedT) : null), [open, plan, job.id, roundedT]);
  const [showOut, setShowOut] = useState(false);

  return (
    <div>
      {job.urgent && <p className="text-[13px] font-bold text-late">Urgent call</p>}
      <h2 className="text-2xl leading-tight font-extrabold">{job.title}</h2>
      <p className="mt-1 text-[15px] text-ink-2">{job.customer}, {job.place}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px] text-ink-3">
        <div><dd className="text-[17px] font-bold text-ink">{fmtClock(job.windowStart)} to {fmtClock(job.windowEnd)}</dd><dt>Arrival window</dt></div>
        <div><dd className="text-[17px] font-bold text-ink capitalize">{job.skill}</dd><dt>{job.plannedMinutes} min planned</dt></div>
      </dl>

      {owner && forecast && (
        <div className="mt-4 flex items-center gap-3 rounded-lg bg-sunk p-3">
          <Bullet tech={owner.tech} />
          <p className="text-[14px] leading-snug">
            <b>{owner.tech.name}</b>{" "}
            {forecast.state === "done" ? `finished at ${fmtClock(forecast.endAt)}.` : forecast.state === "active" && board.t >= forecast.stop.arriveAt ? `arrived at ${fmtClock(forecast.stop.arriveAt)}. Marked automatically by geofence.` : `should arrive about ${fmtClock(forecast.arriveAt)}.`}{" "}
            {forecast.risk !== "fine" && <RiskText f={forecast} />}
          </p>
        </div>
      )}

      <a href={trackHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[14px] font-semibold underline underline-offset-3">
        Open the customer&apos;s tracking link
      </a>

      {ranking && (
        <section className="mt-5">
          <h3 className="text-[15px] font-extrabold">{owner ? "Move it to someone else" : "Best technician for this job"}</h3>
          <p className="text-[13px] leading-snug text-ink-3">Each option replays that person&apos;s whole day with this job added.</p>
          <ul className="mt-2 flex flex-col gap-2">
            {ranking.candidates.map((c, i) => (
              <li key={c.tech.id} className={`rounded-lg border p-3 ${i === 0 ? "border-ink" : "border-hair"}`}>
                <div className="flex items-center gap-2.5">
                  <Bullet tech={c.tech} />
                  <span className="flex-1 text-[15px] font-bold">{c.tech.name}{i === 0 ? ", best fit" : ""}</span>
                  <button
                    type="button"
                    onClick={() => onAssign(job.id, c)}
                    className={`rounded-md px-3 py-1.5 text-[14px] font-bold ${i === 0 ? "bg-cta text-on-cta" : "bg-sunk"}`}
                    aria-label={`Assign to ${c.tech.name}`}
                  >
                    Assign
                  </button>
                </div>
                <p className={`mt-1.5 text-[13.5px] leading-snug ${c.knockOnLate > 0 || c.minutesLate > 0 ? "text-tight" : "text-ink-2"}`}>{c.why}</p>
              </li>
            ))}
          </ul>
          {ranking.candidates.length === 0 && <p className="mt-2 text-[14px] text-late">Nobody on shift can take this today. Rebook it, or call in overtime.</p>}
          {ranking.ruledOut.length > 0 && (
            <button type="button" onClick={() => setShowOut((v) => !v)} className="mt-2 text-[13px] font-semibold text-ink-3 underline underline-offset-2" aria-expanded={showOut}>
              {showOut ? "Hide" : "Show"} {ranking.ruledOut.length} ruled out
            </button>
          )}
          {showOut && (
            <ul className="mt-1 text-[13px] text-ink-3">
              {ranking.ruledOut.map((r) => <li key={r.tech.id}>{r.tech.name}: {r.reason}</li>)}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
