"use client";

import { COMPANY, customerView, DAY_END, DEMO_START, fmtClock, seedPlan, withAssignment, type CustomerStage } from "@crewline/core";
import "@/lib/map-setup";
import { Map as MLMap, Marker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";

const STEPS: { key: CustomerStage[]; label: string }[] = [
  { key: ["scheduled", "next", "unassigned"], label: "Booked" },
  { key: ["on-the-way"], label: "On the way" },
  { key: ["here"], label: "Here" },
  { key: ["done"], label: "Done" },
];

const HEADLINE: Record<CustomerStage, (name: string, eta: number | null, end: string) => string> = {
  unassigned: () => "We're finding you a technician",
  scheduled: (name, _e, end) => `${name} will be with you by ${end}`,
  next: (name, eta) => `You're next. ${name} should leave soon${eta ? ` and arrive in about ${eta} min` : ""}`,
  "on-the-way": (name, eta) => `${name} is ${eta} ${eta === 1 ? "minute" : "minutes"} away`,
  here: (name) => `${name} has arrived`,
  done: (name) => `All done. Thanks for choosing us, from ${name} and the team`,
};

/**
 * What a customer sees. It reads only `customerView`, which leaves out everything else about
 * the crew. The clock runs fast here too, so the demo shows a whole visit in a minute or so.
 */
export function TrackView({ jobId, t: startAt, tech, slot, at }: { jobId: string; t?: number; tech?: string; slot?: number; at?: number }) {
  const plan = useMemo(() => {
    const base = seedPlan();
    return tech && Number.isFinite(slot) && Number.isFinite(at) ? withAssignment(base, jobId, tech, slot!, at!) : base;
  }, [jobId, tech, slot, at]);
  const [t, setT] = useState(startAt ?? DEMO_START);
  const view = useMemo(() => customerView(plan, jobId, t), [plan, jobId, t]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setT((v) => Math.min(DAY_END, v + 0.5)), 500);
    return () => window.clearInterval(id);
  }, []);

  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const techMarker = useRef<Marker | null>(null);
  const destination = view?.destination;
  useEffect(() => {
    if (!box.current || !destination) return;
    const dark = document.documentElement.classList.contains("dark");
    const m = new MLMap({
      container: box.current,
      style: `https://tiles.openfreemap.org/styles/${dark ? "dark" : "positron"}`,
      center: [destination.lng, destination.lat],
      zoom: 13,
      attributionControl: { compact: true },
      dragRotate: false,
    });
    const home = document.createElement("div");
    home.className = "size-4 rounded-full border-[4px] border-[#0e1412] bg-white";
    new Marker({ element: home }).setLngLat([destination.lng, destination.lat]).addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      techMarker.current = null;
    };
  }, [destination]);

  const position = view?.position ?? null;
  const name = view?.techName ?? "";
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!position) {
      techMarker.current?.remove();
      techMarker.current = null;
      return;
    }
    if (!techMarker.current) {
      const el = document.createElement("div");
      el.className = "bullet tech-marker";
      el.style.background = "#0e1412";
      el.textContent = name.slice(0, 1);
      techMarker.current = new Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(m);
      if (destination) m.fitBounds([[Math.min(position.lng, destination.lng), Math.min(position.lat, destination.lat)], [Math.max(position.lng, destination.lng), Math.max(position.lat, destination.lat)]], { padding: 70, maxZoom: 14, duration: 800 });
    }
    techMarker.current?.setLngLat([position.lng, position.lat]);
  }, [position, name, destination]);

  if (!view) {
    return (
      <main className="flex h-dvh items-center justify-center bg-page p-8 text-center">
        <p className="max-w-xs text-lg">This tracking link isn&apos;t valid. Check the message from {COMPANY}, or call them.</p>
      </main>
    );
  }

  const current = STEPS.findIndex((s) => s.key.includes(view.stage));

  return (
    <main className="flex h-dvh flex-col bg-page">
      <div ref={box} className="min-h-0 flex-1" role="img" aria-label={`Map around ${view.place}`} />
      <section className="border-t border-hair bg-panel px-5 pt-5 pb-6">
        <div className="mx-auto max-w-md">
          <p className="text-[13px] font-semibold text-ink-3">{COMPANY}</p>
          <h1 className="mt-1 text-[28px] leading-[1.1] font-extrabold" aria-live="polite">
            {HEADLINE[view.stage](view.techName ?? "Your technician", view.etaMinutes, fmtClock(view.windowEnd))}
          </h1>
          <p className="mt-2 text-[15px] text-ink-2">{view.title}, {view.place}. Your window is {fmtClock(view.windowStart)} to {fmtClock(view.windowEnd)}.</p>

          {/* The visit, drawn as the same line a dispatcher sees. */}
          <ol className="relative mt-5 flex justify-between" aria-label="Progress">
            <span className="absolute top-[9px] right-6 left-6 h-1.5 rounded-full bg-sunk" aria-hidden="true" />
            <span className="absolute top-[9px] left-6 h-1.5 rounded-full bg-ink transition-all" style={{ width: `calc((100% - 48px) * ${Math.max(0, current) / (STEPS.length - 1)})` }} aria-hidden="true" />
            {STEPS.map((s, i) => (
              <li key={s.label} className="relative z-10 flex w-12 flex-col items-center gap-1.5" aria-current={i === current ? "step" : undefined}>
                <span className={`size-6 rounded-full border-[4px] border-ink ${i <= current ? "bg-ink" : "bg-panel"}`} />
                <span className={`text-center text-[12px] leading-tight ${i === current ? "font-bold" : "text-ink-3"}`}>{s.label}</span>
              </li>
            ))}
          </ol>

          <p className="mt-4 text-[12.5px] leading-snug text-ink-3">
            {view.techName ?? "Your technician"}&apos;s location appears here only while driving to you, and disappears on arrival. Demo with a made-up company. The clock runs fast.
          </p>
        </div>
      </section>
    </main>
  );
}
