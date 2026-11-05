"use client";

import { fmtClock, jobVisible, PLACES, trailAt, type Board, type Job, type LatLng, type LiveDevice, type Plan } from "@crewline/core";
import "@/lib/map-setup";
import { Map as MLMap, Marker, type GeoJSONSource, type LineLayerSpecification, type MapLayerMouseEvent } from "maplibre-gl";
import { useEffect, useRef } from "react";

const STYLE = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };

const bounds = (): [[number, number], [number, number]] => {
  const pts = Object.values(PLACES);
  return [
    [Math.min(...pts.map((p) => p.lng)), Math.min(...pts.map((p) => p.lat))],
    [Math.max(...pts.map((p) => p.lng)), Math.max(...pts.map((p) => p.lat))],
  ];
};

const line = (path: LatLng[], props: Record<string, unknown>) => ({
  type: "Feature" as const,
  properties: props,
  geometry: { type: "LineString" as const, coordinates: path.map((p) => [p.lng, p.lat]) },
});

type Props = {
  plan: Plan;
  board: Board;
  dark: boolean;
  selectedTech: string | null;
  selectedJob: string | null;
  onTech: (id: string) => void;
  onJob: (id: string) => void;
  /** Real phones connected through the tracking server. */
  devices?: LiveDevice[];
};

export function MapView({ plan, board, dark, selectedTech, selectedJob, onTech, onJob, devices = [] }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const ready = useRef(false);
  const handlers = useRef({ onTech, onJob });
  const draw = useRef<() => void>(() => {});
  const flewToDevice = useRef(false);

  useEffect(() => {
    handlers.current = { onTech, onJob };
  }, [onTech, onJob]);

  // Redraws every frame the board changes: only the data changes, not the layers.
  useEffect(() => {
    draw.current = () => {
      const m = map.current;
      if (!m || !ready.current) return;
      const focus = selectedTech ?? null;
      const routes = [];
      const trails = [];
      for (const day of board.days) {
        const color = day.tech.color;
        const dim = focus && focus !== day.tech.id;
        const ahead = board.forecasts[day.tech.id]?.filter((f) => f.state !== "done") ?? [];
        for (const f of ahead) {
          const now = board.techs.find((x) => x.tech.id === day.tech.id);
          const share = now?.stop?.job.id === f.stop.job.id ? now.legShare : 0;
          const left = share > 0 ? [now!.position, ...f.stop.leg.path.slice(Math.ceil(share * (f.stop.leg.path.length - 1)))] : f.stop.leg.path;
          routes.push(line(left, { color, opacity: dim ? 0.08 : focus ? 0.9 : 0.34, width: focus === day.tech.id ? 4 : 2.5 }));
        }
        const trail = trailAt(plan, day, board.t);
        if (trail.length > 1) trails.push(line(trail, { color, opacity: dim ? 0.1 : focus ? 0.55 : 0.5, width: focus === day.tech.id ? 4 : 3 }));
      }
      (m.getSource("routes") as GeoJSONSource).setData({ type: "FeatureCollection", features: routes });
      (m.getSource("trails") as GeoJSONSource).setData({ type: "FeatureCollection", features: trails });

      const statuses = new Map<string, { job: Job; color: string; state: string; risk: string; dim: boolean }>();
      for (const day of board.days) {
        for (const f of board.forecasts[day.tech.id] ?? []) {
          statuses.set(f.stop.job.id, { job: f.stop.job, color: day.tech.color, state: f.state, risk: f.risk, dim: !!focus && focus !== day.tech.id });
        }
      }
      const pins = [...statuses.values()].map(({ job, color, state, risk, dim }) => ({
        type: "Feature" as const,
        properties: { id: job.id, color, done: state === "done", risk, selected: job.id === selectedJob, opacity: dim ? 0.15 : state === "done" ? 0.5 : 1 },
        geometry: { type: "Point" as const, coordinates: [job.at.lng, job.at.lat] },
      }));
      for (const job of board.unassigned) {
        if (!jobVisible(job, board.t)) continue;
        pins.push({
          type: "Feature" as const,
          properties: { id: job.id, color: "#cf2317", done: false, risk: "late", selected: job.id === selectedJob, opacity: 1 },
          geometry: { type: "Point" as const, coordinates: [job.at.lng, job.at.lat] },
        });
      }
      (m.getSource("jobs") as GeoJSONSource).setData({ type: "FeatureCollection", features: pins });

      const seen = new Set<string>();
      for (const x of board.techs) {
        if (x.status === "off") continue;
        seen.add(x.tech.id);
        const existing = markers.current.get(x.tech.id);
        let marker: Marker;
        if (existing) {
          marker = existing;
        } else {
          const el = document.createElement("button");
          el.className = "bullet tech-marker";
          el.style.background = x.tech.color;
          el.textContent = x.tech.line;
          el.setAttribute("aria-label", `Technician ${x.tech.name}`);
          const id = x.tech.id;
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            handlers.current.onTech(id);
          });
          marker = new Marker({ element: el }).setLngLat([x.position.lng, x.position.lat]).addTo(m);
          markers.current.set(id, marker);
        }
        marker.setLngLat([x.position.lng, x.position.lat]);
        const el = marker.getElement();
        el.dataset.dim = String(!!focus && focus !== x.tech.id);
        el.dataset.stale = String(x.noSignalFor !== null);
        el.title = x.noSignalFor !== null ? `${x.tech.name}: no signal for ${Math.round(x.noSignalFor)} min` : `${x.tech.name}, ${x.status}`;
      }
      for (const device of devices) {
        const key = `device-${device.id}`;
        seen.add(key);
        const existingDevice = markers.current.get(key);
        let marker: Marker;
        if (existingDevice) {
          marker = existingDevice;
        } else {
          const el = document.createElement("div");
          el.className = "bullet tech-marker";
          el.style.background = "#0e1412";
          el.textContent = device.name.slice(0, 1);
          el.title = `${device.name} (live phone)`;
          marker = new Marker({ element: el }).setLngLat([device.at.lng, device.at.lat]).addTo(m);
          markers.current.set(key, marker);
        }
        marker.setLngLat([device.at.lng, device.at.lat]);
      }
      // The first phone to appear may be anywhere, so the map goes to it once.
      if (devices.length > 0 && !flewToDevice.current) {
        flewToDevice.current = true;
        m.flyTo({ center: [devices[0].at.lng, devices[0].at.lat], zoom: 14 });
      }
      for (const [id, marker] of markers.current) {
        if (!seen.has(id)) {
          marker.remove();
          markers.current.delete(id);
        }
      }
    };
    draw.current();
  }, [board, plan, selectedTech, selectedJob, devices]);

  useEffect(() => {
    if (!box.current) return;
    const m = new MLMap({
      container: box.current,
      style: STYLE[document.documentElement.classList.contains("dark") ? "dark" : "light"],
      bounds: bounds(),
      fitBoundsOptions: { padding: { top: 30, bottom: 30, left: 30, right: 30 } },
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    map.current = m;
    const addLayers = () => {
      for (const id of ["routes", "trails", "jobs"]) {
        if (!m.getSource(id)) m.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      }
      const layout = { "line-cap": "round" as const, "line-join": "round" as const };
      const paint = { "line-color": ["get", "color"], "line-width": ["get", "width"], "line-opacity": ["get", "opacity"] } as LineLayerSpecification["paint"];
      if (!m.getLayer("routes")) m.addLayer({ id: "routes", type: "line", source: "routes", layout, paint: { ...paint, "line-dasharray": [1.2, 2] } });
      if (!m.getLayer("trails")) m.addLayer({ id: "trails", type: "line", source: "trails", layout, paint });
      if (!m.getLayer("jobs")) {
        m.addLayer({
          id: "jobs",
          type: "circle",
          source: "jobs",
          paint: {
            "circle-radius": ["case", ["get", "selected"], 9, 6],
            "circle-color": ["case", ["get", "done"], ["get", "color"], "#ffffff"],
            "circle-stroke-color": ["case", ["==", ["get", "risk"], "late"], "#cf2317", ["==", ["get", "risk"], "tight"], "#e09a00", ["get", "color"]],
            "circle-stroke-width": ["case", ["get", "selected"], 4, 3],
            "circle-opacity": ["get", "opacity"],
            "circle-stroke-opacity": ["get", "opacity"],
          },
        });
      }
      ready.current = true;
      draw.current();
    };
    m.on("style.load", addLayers);
    m.on("click", "jobs", (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") handlers.current.onJob(id);
    });
    m.on("mouseenter", "jobs", () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "jobs", () => {
      m.getCanvas().style.cursor = "";
    });
    const observer = new ResizeObserver(() => m.resize());
    observer.observe(box.current);
    const allMarkers = markers.current;
    return () => {
      observer.disconnect();
      allMarkers.clear();
      ready.current = false;
      m.remove();
      map.current = null;
    };
  }, []);

  // A theme change swaps the base map; the layers go back on through style.load.
  const firstTheme = useRef(true);
  useEffect(() => {
    if (firstTheme.current) {
      firstTheme.current = false;
      return;
    }
    ready.current = false;
    map.current?.setStyle(STYLE[dark ? "dark" : "light"]);
  }, [dark]);

  const label = `Map of the crew at ${fmtClock(board.t)}. ${board.onShift} on shift, ${board.atRisk.length} jobs at risk. The same information is in the line board and the panel.`;
  return <div ref={box} className="h-full w-full" role="img" aria-label={label} />;
}

