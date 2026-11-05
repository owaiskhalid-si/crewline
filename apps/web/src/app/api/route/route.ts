import { decodePolyline } from "@crewline/core";
import { z } from "zod";

// Real road paths for jobs assigned during the demo. Results are cached and calls limited, in
// keeping with the public routing server's usage policy. If it's unavailable the app keeps its estimate.
const cache = new Map<string, unknown>();
const MAX_CACHE = 500;
let calls = { minute: 0, count: 0 };
const MAX_PER_MINUTE = 20;

const Coord = z.string().transform((v, ctx) => {
  const [lat, lng] = v.split(",").map(Number);
  // Only inside the Toronto area, where the demo crew works.
  if (!(lat > 43.4 && lat < 44 && lng > -80 && lng < -79)) {
    ctx.addIssue({ code: "custom", message: "Outside the demo area" });
    return z.NEVER;
  }
  return { lat, lng };
});

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = z.object({ a: Coord, b: Coord }).safeParse({ a: params.get("a"), b: params.get("b") });
  if (!parsed.success) return Response.json({ error: "Invalid coordinates" }, { status: 400 });
  const { a, b } = parsed.data;
  const key = `${a.lat},${a.lng};${b.lat},${b.lng}`;
  if (cache.has(key)) return Response.json(cache.get(key));

  const minute = Math.floor(Date.now() / 60_000);
  if (calls.minute !== minute) calls = { minute, count: 0 };
  if (++calls.count > MAX_PER_MINUTE) return Response.json({ error: "Too many requests" }, { status: 429 });

  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=polyline`, {
      headers: { "User-Agent": "Crewline demo" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as { routes: { geometry: string; duration: number }[] };
    // The free router assumes empty roads, so its times get the same city traffic factor as the demo day.
    const leg = { path: decodePolyline(json.routes[0].geometry), minutes: Math.round((json.routes[0].duration / 60) * 16) / 10 };
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(key, leg);
    return Response.json(leg);
  } catch {
    return Response.json({ error: "Routing is unavailable" }, { status: 503 });
  }
}
