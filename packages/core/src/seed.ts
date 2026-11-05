// A fictional home-services company in Toronto. People are made up; places are neighbourhoods,
// never house addresses. Overruns are planted so the board has something real to catch.
import type { LatLng } from "./geo";
import routes from "./routes.json";
import { decodePolyline } from "./geo";
import type { Job, Plan, Skill, Tech } from "./types";

export const COMPANY = "Lakeline Home Services";

export const PLACES: Record<string, LatLng> = {
  Leslieville: { lat: 43.6628, lng: -79.333 },
  Riverdale: { lat: 43.6712, lng: -79.351 },
  "The Annex": { lat: 43.67, lng: -79.407 },
  "Liberty Village": { lat: 43.638, lng: -79.421 },
  "High Park": { lat: 43.651, lng: -79.463 },
  "The Junction": { lat: 43.665, lng: -79.47 },
  Greektown: { lat: 43.678, lng: -79.349 },
  "The Beaches": { lat: 43.671, lng: -79.296 },
  Yorkville: { lat: 43.671, lng: -79.393 },
  Rosedale: { lat: 43.679, lng: -79.379 },
  "Forest Hill": { lat: 43.695, lng: -79.414 },
  Davisville: { lat: 43.699, lng: -79.397 },
  Leaside: { lat: 43.709, lng: -79.364 },
  "East York": { lat: 43.695, lng: -79.333 },
  "Little Italy": { lat: 43.655, lng: -79.419 },
  Kensington: { lat: 43.654, lng: -79.4 },
  Distillery: { lat: 43.65, lng: -79.359 },
  "St. Lawrence": { lat: 43.649, lng: -79.371 },
  Parkdale: { lat: 43.64, lng: -79.437 },
  Roncesvalles: { lat: 43.649, lng: -79.45 },
  "Dufferin Grove": { lat: 43.657, lng: -79.434 },
  "Christie Pits": { lat: 43.665, lng: -79.421 },
  "Bloor West": { lat: 43.649, lng: -79.484 },
  "Lawrence Park": { lat: 43.725, lng: -79.402 },
  "Don Mills": { lat: 43.737, lng: -79.342 },
  Cabbagetown: { lat: 43.666, lng: -79.365 },
  Corktown: { lat: 43.653, lng: -79.36 },
  "Upper Beaches": { lat: 43.683, lng: -79.312 },
  "Wychwood": { lat: 43.682, lng: -79.423 },
  "Moore Park": { lat: 43.69, lng: -79.383 },
};

export const DEPOT_AT: LatLng = { lat: 43.656, lng: -79.34 };

const h = (hour: number, minute = 0) => hour * 60 + minute;

// Colours are chosen like a transit map's: distinct at a glance, and readable on a light or dark map.
export const TECHS: Tech[] = [
  { id: "sam", name: "Sam", line: "1", color: "#E5352B", skills: ["heating", "plumbing"], shiftStart: h(8), shiftEnd: h(17) },
  { id: "priya", name: "Priya", line: "2", color: "#0B6FD9", skills: ["electrical"], shiftStart: h(8), shiftEnd: h(16, 30) },
  { id: "jordan", name: "Jordan", line: "3", color: "#0E9F5B", skills: ["plumbing"], shiftStart: h(8, 30), shiftEnd: h(17) },
  { id: "amara", name: "Amara", line: "4", color: "#E09A00", skills: ["heating", "electrical"], shiftStart: h(8), shiftEnd: h(17), signalGaps: [{ from: h(13, 5), to: h(13, 24) }] },
  { id: "lucas", name: "Lucas", line: "5", color: "#8A3FD1", skills: ["heating"], shiftStart: h(9), shiftEnd: h(17) },
  { id: "mei", name: "Mei", line: "6", color: "#E0408A", skills: ["plumbing", "electrical"], shiftStart: h(8), shiftEnd: h(16) },
  { id: "omar", name: "Omar", line: "7", color: "#0AA5B5", skills: ["heating", "plumbing"], shiftStart: h(8, 30), shiftEnd: h(17) },
  { id: "tess", name: "Tess", line: "8", color: "#7A5A2E", skills: ["electrical", "plumbing"], shiftStart: h(9), shiftEnd: h(17) },
];

type J = [place: string, title: string, skill: Skill, windowStart: number, windowEnd: number, planned: number, actual: number, customer: string];

const DAY: Record<string, J[]> = {
  sam: [
    ["Riverdale", "Furnace tune-up", "heating", h(8, 15), h(10), 50, 46, "Dana R."],
    ["Greektown", "Leaking kitchen tap", "plumbing", h(9, 30), h(11), 40, 44, "Nikos P."],
    // This one overruns badly, and pushes the Leaside visit past its window.
    ["East York", "Boiler not firing", "heating", h(10, 30), h(12), 60, 112, "Ruth A."],
    ["Leaside", "Thermostat swap", "heating", h(11, 45), h(12, 20), 35, 33, "Tom B."],
    ["Don Mills", "Water heater flush", "plumbing", h(14), h(16), 55, 52, "Hana S."],
  ],
  priya: [
    ["Yorkville", "Panel inspection", "electrical", h(8, 30), h(10), 45, 42, "Elena V."],
    ["The Annex", "Dead outlets, kitchen", "electrical", h(9, 30), h(11, 30), 40, 38, "Marcus L."],
    ["Christie Pits", "EV charger quote", "electrical", h(11), h(13), 30, 28, "Ines F."],
    ["Wychwood", "Pot lights install", "electrical", h(13), h(15, 30), 90, 96, "Paul D."],
  ],
  jordan: [
    ["St. Lawrence", "Blocked main drain", "plumbing", h(8, 45), h(10, 30), 60, 58, "Clara W."],
    ["Corktown", "Toilet replacement", "plumbing", h(10), h(12), 70, 66, "Ben O."],
    ["Cabbagetown", "Basement sump pump", "plumbing", h(12, 30), h(14, 30), 75, 104, "Grace H."],
    ["Distillery", "Shower valve leak", "plumbing", h(13, 45), h(14, 20), 45, 41, "Ravi K."],
  ],
  amara: [
    ["Rosedale", "Furnace no heat", "heating", h(8, 15), h(9, 45), 60, 54, "Sofia M."],
    ["Moore Park", "Humidifier install", "heating", h(10), h(12), 80, 76, "Aaron J."],
    ["Davisville", "Smart thermostat setup", "electrical", h(12, 15), h(14), 35, 38, "Lena T."],
    // The underground garage here is why Amara's signal drops at 13:05.
    ["Lawrence Park", "Garage heater wiring", "electrical", h(13), h(15), 70, 68, "Victor N."],
  ],
  lucas: [
    ["Forest Hill", "Heat pump service", "heating", h(9, 15), h(11), 65, 60, "Maya C."],
    ["Davisville", "Duct inspection", "heating", h(11, 15), h(13), 50, 47, "Owen G."],
    ["Leaside", "Furnace filter and check", "heating", h(13, 30), h(15), 30, 29, "Julia E."],
  ],
  mei: [
    ["Leslieville", "Dishwasher hookup", "plumbing", h(8, 15), h(9, 45), 40, 37, "Anna Z."],
    ["The Beaches", "Hot water tank leak", "plumbing", h(9, 45), h(11, 15), 70, 73, "Theo Q."],
    ["Upper Beaches", "Breaker keeps tripping", "electrical", h(11, 30), h(13, 15), 45, 41, "Nora I."],
    ["East York", "Bathroom fan wiring", "electrical", h(13, 30), h(15), 50, 48, "Sam Y."],
  ],
  omar: [
    ["Liberty Village", "Condo heat pump", "heating", h(8, 45), h(10, 30), 55, 52, "Kai U."],
    ["Parkdale", "Radiator bleed and valve", "heating", h(10, 15), h(12), 45, 49, "Iris P."],
    ["Roncesvalles", "Outdoor tap repair", "plumbing", h(12), h(13, 30), 35, 31, "Felix A."],
    ["High Park", "Boiler annual service", "heating", h(14), h(16), 60, 57, "Rosa D."],
  ],
  tess: [
    ["Kensington", "Shop rewiring quote", "electrical", h(9, 15), h(11), 40, 36, "Dev S."],
    ["Little Italy", "Kitchen sink drain", "plumbing", h(10, 45), h(12, 15), 45, 42, "Gia B."],
    ["Dufferin Grove", "Porch light circuit", "electrical", h(12, 30), h(14), 40, 39, "Noah V."],
    ["The Junction", "Laundry hookup", "plumbing", h(14, 15), h(16), 50, 53, "Ada K."],
    ["Bloor West", "Doorbell and outlet", "electrical", h(15), h(16, 45), 30, 28, "Leo R."],
  ],
};

/** The call that comes in mid-morning, for the dispatcher to place. */
export const URGENT_JOB_ID = "call-no-heat";

function buildPlan(): Plan {
  const jobs: Job[] = [];
  const routeMap: Plan["routes"] = {};
  for (const [techId, list] of Object.entries(DAY)) {
    routeMap[techId] = list.map(([place, title, skill, windowStart, windowEnd, plannedMinutes, actualMinutes, customer], i) => {
      const id = `${techId}-${i + 1}`;
      jobs.push({ id, title, customer, place, at: PLACES[place], windowStart, windowEnd, skill, plannedMinutes, actualMinutes });
      return id;
    });
  }
  jobs.push({
    id: URGENT_JOB_ID,
    title: "No heat, baby at home",
    customer: "Tara F.",
    place: "Cabbagetown",
    at: PLACES.Cabbagetown,
    windowStart: h(11, 40),
    windowEnd: h(13),
    skill: "heating",
    plannedMinutes: 50,
    actualMinutes: 48,
    urgent: true,
    createdAt: h(11, 40),
  });

  const legs: Plan["legs"] = {};
  for (const [key, leg] of Object.entries(routes as Record<string, { p: string; m: number }>)) {
    legs[key] = { path: decodePolyline(leg.p), minutes: leg.m };
  }
  return { depot: DEPOT_AT, techs: TECHS, jobs, routes: routeMap, legs };
}

export const seedPlan = buildPlan;

/** The demo opens at a moment when the board already has a story. */
export const DEMO_START = h(11, 18);
export const DAY_START = h(7, 45);
export const DAY_END = h(17, 15);
