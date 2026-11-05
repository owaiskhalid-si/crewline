"use client";

import { boardAt, DAY_END, DAY_START, DEMO_START, eventsUpTo, seedPlan, withAssignment, type Board, type Candidate, type DayEvent, type LatLng, type Plan } from "@crewline/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const SPEEDS = [1, 60, 240] as const;
export type Speed = (typeof SPEEDS)[number];

/** Redraws per second while the clock runs. Enough for smooth markers, kind to a laptop. */
const FPS = 15;

export type Sim = {
  plan: Plan;
  t: number;
  playing: boolean;
  speed: Speed;
  board: Board;
  events: DayEvent[];
  setPlaying: (p: boolean) => void;
  setSpeed: (s: Speed) => void;
  scrub: (t: number) => void;
  assign: (jobId: string, c: Pick<Candidate, "insertAt"> & { tech: { id: string } }) => void;
};

/** Asks for real road paths for a newly assigned job. The estimate stays if this fails. */
async function fetchLeg(fromId: string, toId: string, a: LatLng, b: LatLng): Promise<Plan["legs"][string] | null> {
  try {
    const res = await fetch(`/api/route?a=${a.lat},${a.lng}&b=${b.lat},${b.lng}`);
    if (!res.ok) return null;
    return (await res.json()) as Plan["legs"][string];
  } catch {
    return null;
  }
}

export function useSim(startPlaying = true): Sim {
  const [plan, setPlan] = useState<Plan>(seedPlan);
  const [t, setT] = useState(DEMO_START);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(60);
  const clock = useRef(DEMO_START);

  // The clock starts on arrival, unless the visitor asked for less motion.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (startPlaying && !reduced) {
      const id = window.setTimeout(() => setPlaying(true), 900);
      return () => window.clearTimeout(id);
    }
  }, [startPlaying]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let drawn = last;
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      clock.current = Math.min(DAY_END, clock.current + (dt / 60_000) * speed);
      if (now - drawn >= 1000 / FPS) {
        drawn = now;
        setT(clock.current);
        if (clock.current >= DAY_END) {
          setPlaying(false);
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed]);

  const scrub = useCallback((next: number) => {
    const value = Math.max(DAY_START, Math.min(DAY_END, next));
    clock.current = value;
    setT(value);
  }, []);

  const assign = useCallback<Sim["assign"]>((jobId, c) => {
    const at = clock.current;
    setPlan((current) => {
      const next = withAssignment(current, jobId, c.tech.id, c.insertAt, at);
      const route = next.routes[c.tech.id];
      const index = route.indexOf(jobId);
      const job = next.jobs.find((j) => j.id === jobId)!;
      const prevId = route[index - 1];
      const nextId = route[index + 1];
      const prev = prevId ? next.jobs.find((j) => j.id === prevId)! : null;
      const after = nextId ? next.jobs.find((j) => j.id === nextId)! : null;
      // Real roads arrive shortly after; the day already works from an estimate until then.
      void Promise.all([
        fetchLeg(prevId ?? "depot", jobId, prev?.at ?? next.depot, job.at).then((leg) => [`${prevId ?? "depot"}>${jobId}`, leg] as const),
        after ? fetchLeg(jobId, after.id, job.at, after.at).then((leg) => [`${jobId}>${after.id}`, leg] as const) : Promise.resolve(null),
      ]).then((results) => {
        setPlan((p) => {
          const legs = { ...p.legs };
          for (const r of results) if (r && r[1]) legs[r[0]] = r[1];
          return { ...p, legs };
        });
      });
      return next;
    });
  }, []);

  const board = useMemo(() => boardAt(plan, t), [plan, t]);
  const events = useMemo(() => eventsUpTo(plan, board.days, t), [plan, board.days, t]);

  return { plan, t, playing, speed, board, events, setPlaying, setSpeed, scrub, assign };
}

export function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const update = () => setDark(document.documentElement.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const toggle = useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("crewline-theme", next ? "dark" : "light");
    } catch {}
  }, []);
  return { dark, toggle };
}
