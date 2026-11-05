"use client";

import { COMPANY, fmtClock } from "@crewline/core";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { SPEEDS, useSim, useTheme } from "@/lib/use-sim";
import { useDevices } from "@/lib/use-devices";
import { Copilot } from "./copilot";
import { LineBoard } from "./line-board";
import { Attention, JobDetail, TechDetail } from "./side-panel";

// The map needs a browser, so it isn't drawn on the server.
const MapView = dynamic(() => import("./map-view").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-sunk" />,
});

type View = "map" | "board" | "panel";

function Stat({ value, label, tone }: { value: string | number; label: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className={`text-[22px] leading-none font-extrabold ${tone ?? ""}`}>{value}</div>
      <div className="mt-0.5 truncate text-[12px] font-medium text-ink-3">{label}</div>
    </div>
  );
}

export function Dispatch() {
  const sim = useSim();
  const { plan, t, playing, speed, board, events } = sim;
  const { dark, toggle } = useTheme();
  const live = useDevices();
  const [selectedTech, setSelectedTech] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<string | null>(null);
  const [tab, setTab] = useState<"now" | "copilot">("now");
  const [view, setView] = useState<View>("map");

  const pickTech = useCallback((id: string) => {
    setSelectedJob(null);
    setSelectedTech((cur) => (cur === id ? null : id));
    setTab("now");
    setView("panel");
  }, []);
  const pickJob = useCallback((id: string) => {
    setSelectedJob(id);
    setTab("now");
    setView("panel");
  }, []);
  const back = () => {
    setSelectedJob(null);
    setSelectedTech(null);
  };

  const job = selectedJob ? plan.jobs.find((j) => j.id === selectedJob) : undefined;
  const tech = selectedTech ? board.techs.find((x) => x.tech.id === selectedTech) : undefined;

  const assign = (jobId: string, c: { insertAt: number; tech: { id: string } }) => {
    sim.assign(jobId, c);
    setSelectedTech(c.tech.id);
  };

  const trackHref = job ? trackLink(job.id, plan, Math.round(t)) : "#";
  const needsYou = board.unassigned.length + board.atRisk.length;

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-page">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-hair bg-panel px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="bullet bg-ink text-page" style={{ width: 30, height: 30, fontSize: 17 }} aria-hidden="true">C</span>
          <div className="leading-tight">
            <h1 className="text-[17px] font-extrabold">Crewline</h1>
            <p className="text-[12px] text-ink-3">{COMPANY}, a made-up crew</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => sim.setPlaying(!playing)}
            className="rounded-md bg-cta px-3 py-1.5 text-[14px] font-bold text-on-cta"
            aria-label={playing ? "Pause the day" : "Play the day"}
          >
            {playing ? "Pause" : "Play"}
          </button>
          <div className="flex rounded-md bg-sunk p-0.5" role="group" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => sim.setSpeed(s)}
                aria-pressed={speed === s}
                className={`rounded px-2 py-1 text-[13px] font-bold ${speed === s ? "bg-panel" : "text-ink-2"}`}
                title={s === 1 ? "Real time" : `${s} times real time`}
              >
                {s === 1 ? "Live" : `${s}×`}
              </button>
            ))}
          </div>
        </div>

        <div className="ml-auto grid grid-cols-4 gap-5">
          <Stat value={board.onShift} label="On shift" />
          <Stat value={`${board.done}/${board.total}`} label="Jobs done" />
          <Stat value={board.atRisk.length} label="At risk" tone={board.atRisk.length ? "text-late" : undefined} />
          <Stat value={board.unassigned.length} label="Need a tech" tone={board.unassigned.length ? "text-late" : undefined} />
        </div>

        <button type="button" onClick={toggle} className="rounded-md bg-sunk px-2.5 py-1.5 text-[13px] font-bold" aria-label={dark ? "Use the light theme" : "Use the dark theme"}>
          {dark ? "Light" : "Dark"}
        </button>
      </header>

      {/* On a phone there's room for one view at a time. */}
      <nav className="grid grid-cols-3 border-b border-hair bg-panel lg:hidden" aria-label="Views">
        {([["map", "Map"], ["board", "Lines"], ["panel", needsYou ? `Attention (${needsYou})` : "Attention"]] as const).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setView(key)} aria-pressed={view === key} className={`py-2 text-[14px] font-bold ${view === key ? "border-b-2 border-ink" : "text-ink-3"}`}>
            {label}
          </button>
        ))}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[1fr_380px] lg:grid-rows-[1fr_auto]">
        <section className={`min-h-0 flex-1 ${view === "map" ? "block" : "hidden"} lg:col-start-1 lg:row-start-1 lg:block`} aria-label="Map">
          <MapView plan={plan} board={board} dark={dark} selectedTech={selectedTech} selectedJob={selectedJob} onTech={pickTech} onJob={pickJob} devices={live.devices} />
        </section>

        <section className={`${view === "board" ? "block" : "hidden"} min-h-0 flex-1 overflow-y-auto border-t border-hair bg-page px-2 pt-2 pb-1 lg:col-start-1 lg:row-start-2 lg:block lg:flex-none`} aria-label="Line board">
          <LineBoard board={board} selectedTech={selectedTech} selectedJob={selectedJob} onTech={pickTech} onJob={pickJob} onScrub={sim.scrub} />
        </section>

        <aside className={`${view === "panel" ? "flex" : "hidden"} min-h-0 flex-1 flex-col border-l border-hair bg-panel lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:flex`}>
          <div className="flex items-center gap-1 border-b border-hair px-3 py-2" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "now"} onClick={() => setTab("now")} className={`rounded-md px-3 py-1.5 text-[14px] font-bold ${tab === "now" ? "bg-sunk" : "text-ink-2"}`}>
              {needsYou ? `Attention (${needsYou})` : "Attention"}
            </button>
            <button type="button" role="tab" aria-selected={tab === "copilot"} onClick={() => setTab("copilot")} className={`rounded-md px-3 py-1.5 text-[14px] font-bold ${tab === "copilot" ? "bg-sunk" : "text-ink-2"}`}>
              Copilot
            </button>
            {tab === "now" && (job || tech) && (
              <button type="button" onClick={back} className="ml-auto rounded-md px-2 py-1 text-[13px] font-semibold text-ink-2 hover:bg-sunk">
                Back to all
              </button>
            )}
          </div>
          <div className={`min-h-0 flex-1 ${tab === "copilot" ? "flex flex-col" : "overflow-y-auto p-4"}`}>
            {tab === "copilot" ? (
              <Copilot sim={sim} onJob={pickJob} />
            ) : job ? (
              <JobDetail job={job} plan={plan} board={board} onAssign={assign} trackHref={trackHref} />
            ) : tech ? (
              <TechDetail tech={tech} board={board} onJob={pickJob} />
            ) : (
              <Attention board={board} events={events} onJob={pickJob} onTech={pickTech} live={live} />
            )}
          </div>
          <p className="border-t border-hair px-4 py-2 text-[12px] leading-snug text-ink-3">
            Clock: {fmtClock(t)}. Location is shared only during a shift, and technicians can see exactly what&apos;s shared.
          </p>
        </aside>
      </div>
    </main>
  );
}

/** A link a customer could open. Carries the assignment so a demo reassign still shows up there. */
function trackLink(jobId: string, plan: import("@crewline/core").Plan, t: number) {
  const params = new URLSearchParams({ t: String(t) });
  const owner = Object.entries(plan.routes).find(([, jobs]) => jobs.includes(jobId));
  const job = plan.jobs.find((j) => j.id === jobId);
  if (owner && job?.assignedAt !== undefined) {
    params.set("tech", owner[0]);
    params.set("slot", String(owner[1].indexOf(jobId)));
    params.set("at", String(Math.round(job.assignedAt)));
  }
  return `/track/${jobId}?${params}`;
}

