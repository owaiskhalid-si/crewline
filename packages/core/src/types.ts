import type { LatLng } from "./geo";

export type Skill = "heating" | "plumbing" | "electrical";

/** Times are minutes after midnight, so 690 is 11:30. */
export type Tech = {
  id: string;
  /** First name only: customers and the board never need more. */
  name: string;
  /** The line's bullet on the board, as on a transit map. */
  line: string;
  color: string;
  skills: Skill[];
  shiftStart: number;
  shiftEnd: number;
  /** Stretches with no GPS signal, such as an underground garage. */
  signalGaps?: { from: number; to: number }[];
};

export type Job = {
  id: string;
  title: string;
  /** First name and initial. */
  customer: string;
  place: string;
  at: LatLng;
  windowStart: number;
  windowEnd: number;
  skill: Skill;
  plannedMinutes: number;
  /** How long it really takes. The forecast never reads this until it has happened. */
  actualMinutes: number;
  urgent?: boolean;
  /** When the call came in, for jobs booked during the day. */
  createdAt?: number;
  /** A job given out during the day can't start before it was given out. */
  assignedAt?: number;
};

export type Plan = {
  depot: LatLng;
  techs: Tech[];
  jobs: Job[];
  /** Each technician's jobs, in order. */
  routes: Record<string, string[]>;
  /** Real road paths by "from>to", encoded. Anything missing uses an estimate. */
  legs: Record<string, { path: LatLng[]; minutes: number }>;
};
