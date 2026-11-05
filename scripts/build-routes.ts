// Fetches real road routes for the demo crew's day and stores them in the repo, so the demo
// needs no routing service at runtime. Run once: npx tsx scripts/build-routes.ts
// Routes come from the public OSRM demo server with OpenStreetMap data. One request a second,
// and only for legs not already saved, in keeping with that server's usage policy.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const OUT = "packages/core/src/routes.json";
if (!existsSync(OUT)) writeFileSync(OUT, "{}\n");

async function main() {
  const { seedPlan, DEPOT } = await import("../packages/core/src/index");
  const plan = seedPlan();
  const saved: Record<string, { p: string; m: number }> = JSON.parse(readFileSync(OUT, "utf8"));
  const wanted: [string, { lat: number; lng: number }, { lat: number; lng: number }][] = [];
  for (const jobs of Object.values(plan.routes)) {
    let fromId = DEPOT;
    let from = plan.depot;
    for (const id of jobs) {
      const job = plan.jobs.find((j) => j.id === id)!;
      wanted.push([`${fromId}>${id}`, from, job.at]);
      fromId = id;
      from = job.at;
    }
  }
  for (const [key, a, b] of wanted) {
    if (saved[key]) continue;
    const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=polyline`;
    const res = await fetch(url, { headers: { "User-Agent": "Crewline demo route builder" } });
    if (!res.ok) throw new Error(`${key}: ${res.status}`);
    const json = (await res.json()) as { routes: { geometry: string; duration: number }[] };
    // City traffic: the free router's times assume empty roads.
    saved[key] = { p: json.routes[0].geometry, m: Math.round((json.routes[0].duration / 60) * 1.6 * 10) / 10 };
    writeFileSync(OUT, JSON.stringify(saved) + "\n");
    console.log(key, saved[key].m, "min");
    await new Promise((r) => setTimeout(r, 1100));
  }
  console.log(`${Object.keys(saved).length} legs saved`);
}

void main();
