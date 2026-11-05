"use client";

import { DAY_END, DAY_START, fmtClock, type Board, type StopForecast, type TechNow } from "@crewline/core";
import { memo, useEffect, useRef, useState } from "react";

const NAME_W = 118;
const ROW = 42;
const AXIS = 26;
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

type Props = {
  board: Board;
  selectedTech: string | null;
  selectedJob: string | null;
  onTech: (id: string) => void;
  onJob: (id: string) => void;
  onScrub: (t: number) => void;
};

/**
 * The signature of the app: every technician is a transit line and every job a station.
 * Time runs left to right, so the whole crew's day reads at a glance, and the needle can be
 * dragged to replay any moment.
 */
export function LineBoard({ board, selectedTech, selectedJob, onTech, onJob, onScrub }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1100);

  useEffect(() => {
    if (!box.current) return;
    const observer = new ResizeObserver(([e]) => setWidth(Math.max(760, e.contentRect.width)));
    observer.observe(box.current);
    return () => observer.disconnect();
  }, []);

  const plot = width - NAME_W - 16;
  const x = (t: number) => NAME_W + ((t - DAY_START) / (DAY_END - DAY_START)) * plot;
  const height = AXIS + board.techs.length * ROW + 6;

  return (
    <div ref={box} className="relative w-full overflow-x-auto" tabIndex={0} aria-label="Line board: each technician's day as a transit line. Scrolls sideways on small screens.">
      <div className="relative" style={{ width, height }}>
        <svg width={width} height={height} className="absolute inset-0 block" aria-hidden="true">
          {HOURS.map((hour) => (
            <g key={hour}>
              <line x1={x(hour * 60)} x2={x(hour * 60)} y1={AXIS - 4} y2={height} stroke="var(--hair)" />
              <text x={x(hour * 60)} y={15} textAnchor="middle" fontSize={12} fontWeight={600} fill="var(--ink-3)">{`${String(hour).padStart(2, "0")}:00`}</text>
            </g>
          ))}
          {board.techs.map((tech, row) => (
            <LineRow key={tech.tech.id} tech={tech} stops={board.forecasts[tech.tech.id] ?? []} y={AXIS + row * ROW + 15} x={x} now={board.t} dim={!!selectedTech && selectedTech !== tech.tech.id} />
          ))}
          <line x1={x(board.t)} x2={x(board.t)} y1={AXIS - 4} y2={height} stroke="var(--ink)" strokeWidth={2} />
          <rect x={x(board.t) - 23} y={1} width={46} height={19} rx={4} fill="var(--ink)" />
          <text x={x(board.t)} y={15} textAnchor="middle" fontSize={12.5} fontWeight={800} fill="var(--page)">{fmtClock(board.t)}</text>
        </svg>

        {/* Names and stations are real buttons laid over the drawing. */}
        {board.techs.map((tech, row) => {
          const y = AXIS + row * ROW;
          const dim = !!selectedTech && selectedTech !== tech.tech.id;
          return (
            <div key={tech.tech.id}>
              <button
                type="button"
                onClick={() => onTech(tech.tech.id)}
                aria-pressed={selectedTech === tech.tech.id}
                aria-label={`${tech.tech.name}'s day, line ${tech.tech.line}`}
                className={`absolute left-0 z-10 flex items-center gap-2 rounded-r-md bg-page pr-2 pl-1 text-left transition-opacity hover:bg-sunk ${dim ? "opacity-40" : ""}`}
                style={{ top: y + 4, height: 30, width: NAME_W - 8 }}
              >
                <span className="bullet" style={{ background: tech.tech.color, width: 24, height: 24, fontSize: 13 }}>{tech.tech.line}</span>
                <span className="truncate text-[15px] leading-none font-bold">{tech.tech.name}</span>
              </button>
              {(board.forecasts[tech.tech.id] ?? []).map((f) => {
                const left = x(f.startAt);
                const label = `${f.stop.job.place}: ${f.stop.job.title}, ${f.state}${f.risk === "late" ? `, ${Math.round(f.minutesLate)} minutes late` : f.risk === "tight" ? ", tight" : ""}`;
                return (
                  <button
                    key={f.stop.job.id}
                    type="button"
                    onClick={() => onJob(f.stop.job.id)}
                    aria-label={label}
                    title={label}
                    aria-pressed={selectedJob === f.stop.job.id}
                    className="absolute z-20 rounded-full"
                    style={{ left: left - 13, top: y + 2, width: 26, height: 26 }}
                  />
                );
              })}
            </div>
          );
        })}

        <input
          type="range"
          className="scrub absolute top-0 z-10"
          aria-label="Time of day. Drag to replay the day."
          aria-valuetext={fmtClock(board.t)}
          min={DAY_START}
          max={DAY_END}
          step={1}
          value={Math.round(board.t)}
          onChange={(e) => onScrub(Number(e.target.value))}
          style={{ left: NAME_W, width: plot, height: AXIS }}
        />
      </div>
    </div>
  );
}

const LineRow = memo(function LineRow({ tech, stops, y, x, now, dim }: { tech: TechNow; stops: StopForecast[]; y: number; x: (t: number) => number; now: number; dim: boolean }) {
  const color = tech.tech.color;
  const start = x(tech.tech.shiftStart);
  const end = x(stops.length ? stops[stops.length - 1].endAt : tech.tech.shiftEnd);
  const nowX = Math.min(Math.max(x(now), start), end);
  return (
    <g opacity={dim ? 0.28 : 1}>
      <line x1={start} x2={end} y1={y} y2={y} stroke={color} strokeWidth={6} strokeLinecap="round" opacity={0.28} />
      {now > tech.tech.shiftStart && <line x1={start} x2={nowX} y1={y} y2={y} stroke={color} strokeWidth={6} strokeLinecap="round" />}
      {stops.map((f) => {
        const cx = x(f.startAt);
        const done = f.state === "done";
        const ring = f.risk === "late" ? "var(--late)" : f.risk === "tight" ? "var(--tight)" : color;
        return (
          <g key={f.stop.job.id}>
            {f.state === "active" && <circle cx={cx} cy={y} r={11} fill="none" stroke={color} strokeWidth={2} opacity={0.45} />}
            <circle cx={cx} cy={y} r={7} fill={done ? color : "var(--station)"} stroke={ring} strokeWidth={f.risk === "fine" ? 3 : 3.5} />
            {f.stop.job.urgent && <circle cx={cx} cy={y} r={2.5} fill="var(--late)" />}
            <text x={cx} y={y + 21} textAnchor="middle" fontSize={11} fontWeight={f.risk === "fine" ? 500 : 700} fill={f.risk === "late" ? "var(--late)" : f.risk === "tight" ? "var(--tight)" : "var(--ink-2)"}>
              {f.stop.job.place}
            </text>
          </g>
        );
      })}
    </g>
  );
});
