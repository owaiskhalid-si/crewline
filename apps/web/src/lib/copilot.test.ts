import { rankTechnicians, seedPlan, URGENT_JOB_ID, withAssignment } from "@crewline/core";
import { describe, expect, it } from "vitest";
import { askCopilot, checkReply, offlineCopilot, runTool, TOOL_DECLARATIONS, type Part } from "./copilot";

const T = 702;
const plan = seedPlan();
const reply = (...parts: Part[]) => Promise.resolve({ parts });

describe("copilot tools", () => {
  it("has a handler for every tool it declares", () => {
    for (const t of TOOL_DECLARATIONS) {
      expect(runTool(plan, T, t.name, { job_id: URGENT_JOB_ID, name: "Sam", query: "Leaside" }).result).not.toHaveProperty("error");
    }
  });
  it("reports the board, including the open call", () => {
    const r = runTool(plan, T, "get_board").result as { now: string; unassigned: { job_id: string }[] };
    expect(r.now).toBe("11:42");
    expect(r.unassigned[0].job_id).toBe(URGENT_JOB_ID);
  });
  it("hides a call that hasn't come in yet", () => {
    const early = runTool(plan, 600, "find_job", { query: "baby" }).result as { jobs: unknown[] };
    expect(early.jobs).toEqual([]);
  });
  it("ranks through the same logic as the dispatcher's screen", () => {
    const out = runTool(plan, T, "rank_technicians", { job_id: URGENT_JOB_ID });
    expect(out.ranking!.candidates[0].tech.name).toBe("Lucas");
    expect((out.result.options as { name: string }[])[0].name).toBe("Lucas");
  });
  it("finds a job however it's described", () => {
    for (const query of ["no-heat", "no heat", "No heat Cabbagetown", "cabbagetown no-heat call"]) {
      const r = runTool(plan, T, "find_job", { query }).result as { jobs: { job_id: string }[] };
      expect(r.jobs[0].job_id).toBe(URGENT_JOB_ID);
    }
  });
  it("gives finish times, so the model needn't work them out", () => {
    const r = runTool(plan, T, "technician_day", { name: "Tess" }).result as { stops: { expected_finish: string }[] };
    expect(r.stops.at(-1)!.expected_finish).toMatch(/^\d\d:\d\d$/);
  });
  it("says when a technician has lost signal", () => {
    expect(runTool(plan, 795, "technician_day", { name: "Amara" }).result.no_signal_minutes).toBe(10);
    expect(runTool(plan, T, "technician_day", { name: "Amara" }).result.no_signal_minutes).toBeUndefined();
  });
  it("survives bad arguments", () => {
    expect(runTool(plan, T, "rank_technicians", { job_id: "nope" }).result).toHaveProperty("error");
    expect(runTool(plan, T, "technician_day", { name: "Zed" }).result).toHaveProperty("error");
    expect(runTool(plan, T, "find_job", {}).result).toEqual({ jobs: [] });
    expect(runTool(plan, T, "nope").result).toHaveProperty("error");
  });
  it("gives the model no customer names", () => {
    for (const t of TOOL_DECLARATIONS) {
      const json = JSON.stringify(runTool(plan, T, t.name, { job_id: URGENT_JOB_ID, name: "Sam", query: "Leaside" }).result);
      expect(json).not.toContain("Tom B.");
      expect(json).not.toContain("Tara F.");
    }
  });
});

describe("reply check", () => {
  const results = [{ can_arrive: "12:19", name: "Lucas", list: [{ name: "Sam", at: "09:05" }] }];
  it("accepts times and names the tools returned", () => {
    expect(checkReply("Lucas can be there by 12:19, and Sam left at 9:05.", plan, results, [])).toEqual({ unverifiedTimes: [], unverifiedNames: [] });
  });
  it("accepts a time the dispatcher said themselves", () => {
    expect(checkReply("Before 15:30, yes.", plan, results, ["can it wait until 15:30?"]).unverifiedTimes).toEqual([]);
  });
  it("flags a made-up time or an unchecked person", () => {
    const r = checkReply("Priya can be there by 12:45.", plan, results, []);
    expect(r.unverifiedTimes).toEqual(["12:45"]);
    expect(r.unverifiedNames).toEqual(["Priya"]);
  });
});

describe("copilot loop", () => {
  it("runs tools in the browser, then answers", async () => {
    let round = 0;
    const out = await askCopilot([], "Who takes the call?", plan, T, undefined, () =>
      ++round === 1 ? reply({ functionCall: { name: "rank_technicians", args: { job_id: URGENT_JOB_ID } } }) : reply({ text: "Lucas, by 12:19." }),
    );
    expect(out).toMatchObject({ mode: "live", text: "Lucas, by 12:19.", unverified: [] });
    expect(out.ranking!.job.id).toBe(URGENT_JOB_ID);
    expect(out.steps).toHaveLength(1);
  });
  it("sends the model's parts back untouched", async () => {
    let second: { contents: { parts: Part[] }[] } | undefined;
    let round = 0;
    await askCopilot([], "hi", plan, T, undefined, (body) => {
      if (++round === 2) second = JSON.parse(JSON.stringify(body));
      return round === 1 ? reply({ functionCall: { name: "get_board" }, thoughtSignature: "abc" }) : reply({ text: "ok" });
    });
    expect(second!.contents[1].parts[0].thoughtSignature).toBe("abc");
  });
  it("offers tools on every round but the last, which forces an answer", async () => {
    const flags: boolean[] = [];
    await askCopilot([], "hi", plan, T, undefined, (body) => {
      flags.push(body.allowTools);
      return reply({ functionCall: { name: "get_board" } });
    });
    expect(flags).toEqual([true, true, true, true, false]);
  });
  it("flags what doesn't trace back", async () => {
    const out = await askCopilot([], "hi", plan, T, undefined, () => reply({ text: "Priya will be there at 13:37." }));
    expect(out.unverified).toEqual(["13:37", "Priya"]);
  });
  it("falls back to the rules when the model is out, or the call fails", async () => {
    expect((await askCopilot([], "what's at risk?", plan, T, undefined, () => Promise.resolve(null))).mode).toBe("offline");
    expect((await askCopilot([], "what's at risk?", plan, T, undefined, () => Promise.reject(new Error("net")))).mode).toBe("offline");
  });
});

describe("rule-based copilot", () => {
  it("places the open call with the best technician", () => {
    const r = offlineCopilot("Who should take the no-heat call?", plan, T);
    expect(r.text).toMatch(/^Lucas is the best fit for no heat/);
    expect(r.ranking!.job.id).toBe(URGENT_JOB_ID);
  });
  it("matches a job by what it is, not only by where", () => {
    // Jordan also has a job in Cabbagetown, so the place alone would find the wrong one.
    const assigned = withAssignment(plan, URGENT_JOB_ID, "lucas", 3, T);
    const r = offlineCopilot("Who should take the Cabbagetown no-heat call?", assigned, T);
    expect(r.text).toMatch(/no heat/i);
    expect(r.text).not.toMatch(/sump/i);
  });
  it("says so when a job already has someone", () => {
    const assigned = withAssignment(plan, URGENT_JOB_ID, "lucas", 3, T);
    expect(offlineCopilot("Who should take the no-heat call?", assigned, T).text).toMatch(/Lucas already has/);
  });
  it("describes a technician's day", () => {
    expect(offlineCopilot("How is Sam's day looking?", plan, T).text).toMatch(/^Sam is /);
  });
  it("summarises what's at risk, or that nothing is", () => {
    expect(offlineCopilot("What's at risk?", plan, 725).text).toMatch(/Leaside/);
    expect(offlineCopilot("What's at risk?", plan, 600).text).toMatch(/nothing is at risk/);
  });
  it("has a ranking that matches the screen", () => {
    const a = offlineCopilot("who should take it", plan, T).ranking!.candidates.map((c) => c.tech.id);
    expect(a).toEqual(rankTechnicians(plan, URGENT_JOB_ID, T)!.candidates.map((c) => c.tech.id));
  });
});
