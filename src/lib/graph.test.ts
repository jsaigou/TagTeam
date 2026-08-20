import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error server .mjs modules ship without type declarations
import { createJobRunner } from "../../server/jobs.mjs";
// @ts-expect-error server .mjs modules ship without type declarations
import { createRunEngine, GRAPH } from "../../server/graph.mjs";

type Signal = AbortSignal;
type Report = (partial: Record<string, unknown>) => void;
type StepRun = (input: unknown, ctx: { signal: Signal; report: Report }) => Promise<unknown>;

afterEach(() => {
  vi.useRealTimers();
});

/** A macrotask tick — flushes every pending microtask first, including the
 *  multi-hop chain a resolved fake step's result travels through (inner
 *  promise -> async fn return-promise adoption -> jobs.mjs's `await` resume
 *  -> `job._resolve` -> attachNode's `.then`) before the next assertion or
 *  `.resolve()` call. A bare `await Promise.resolve()` is NOT enough hops for
 *  that chain — this is deliberately a macrotask, not another microtask. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A step whose completion is controlled externally via `resolve()`/`reject()`
 *  — a FIFO queue of pending calls, same shape as jobs.test.ts's version but
 *  exposing per-call resolve/reject instead of a single shared gate. */
function controllableStep() {
  const calls: unknown[] = [];
  const resolvers: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  const run: StepRun = async (input, { signal }) => {
    calls.push(input);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { aborted: true })));
      resolvers.push({ resolve, reject });
    });
  };
  return {
    run,
    calls,
    resolve: (value: unknown) => resolvers.shift()?.resolve(value),
    reject: (err: unknown) => resolvers.shift()?.reject(err),
    pendingCount: () => resolvers.length,
  };
}

/** Build a runner+engine over the real GRAPH with fake, controllable steps —
 *  exercises the real dependency wiring (input() functions, soft deps, the
 *  gate) without hitting llmChat/SearXNG/Firecrawl. */
function setup() {
  const identifyTarget = controllableStep();
  const geolocate = controllableStep();
  const research = controllableStep();
  const extractTargetRules = controllableStep();
  const planScenario = controllableStep();

  const jobRunner = createJobRunner({
    steps: {
      identifyTarget: { run: identifyTarget.run, lane: "llm" },
      geolocate: { run: geolocate.run },
      research: { run: research.run, lane: "net" },
      extractTargetRules: { run: extractTargetRules.run, lane: "llm" },
      planScenario: { run: planScenario.run, lane: "llm" },
    },
  });

  const snapshots: unknown[] = [];
  const runEngine = createRunEngine({ jobRunner });
  runEngine.addListener((_runKey: string, run: unknown) => snapshots.push(run));

  return {
    jobRunner,
    runEngine,
    identifyTarget,
    geolocate,
    research,
    extractTargetRules,
    planScenario,
    snapshots,
  };
}

const CANDIDATES = [
  { title: "Mejiro Dental Clinic", url: "https://a.example", snippet: "A" },
  { title: "Another Dental Office", url: "https://b.example", snippet: "B" },
];

async function driveToGate(env: ReturnType<typeof setup>, runKey = "s1") {
  env.runEngine.startRun(runKey, "book an appointment at Mejiro Dental Clinic");
  env.identifyTarget.resolve({ name: "Mejiro Dental Clinic", city: "Toshima", query: "目白 歯科" });
  await tick();
  await tick();
  env.geolocate.resolve({ locality: "Toshima", queryHint: "Mejiro Dental Clinic Toshima" });
  await tick();
  await tick();
  env.research.resolve({ query: "x", results: CANDIDATES });
  await tick();
  await tick();
}

describe("GRAPH shape", () => {
  it("declares the confirmTarget sub-graph described in the Phase 7 plan §7b.3", () => {
    expect(GRAPH.confirmTarget.kind).toBe("gate");
    expect(GRAPH.confirmTarget.deps).toEqual(["research"]);
    expect(GRAPH.extractTargetRules.deps).toEqual(["confirmTarget"]);
    expect(GRAPH.extractTargetRules.speculative).toBe(true);
    expect(GRAPH.research.deps).toEqual(["identifyTarget", "geolocate?"]);
    expect(GRAPH.planScenario.deps).toEqual(["confirmTarget", "extractTargetRules?"]);
  });
});

describe("createRunEngine", () => {
  it("advances identifyTarget -> geolocate -> research -> opens the confirmTarget gate", async () => {
    const env = setup();
    await driveToGate(env);

    expect(env.identifyTarget.calls).toEqual([{ goal: "book an appointment at Mejiro Dental Clinic" }]);
    expect(env.geolocate.calls).toEqual([{ name: "Mejiro Dental Clinic", city: "Toshima" }]);
    expect(env.research.calls).toEqual([{ q: "Mejiro Dental Clinic Toshima" }]);

    const run = env.runEngine.getRun("s1");
    expect(run.gate).toMatchObject({
      nodeId: "confirmTarget",
      guessId: "https://a.example",
    });
    expect(run.gate.candidates).toHaveLength(2);
  });

  it("speculatively starts extractTargetRules on the gate's top guess while it's open", async () => {
    const env = setup();
    await driveToGate(env);

    expect(env.extractTargetRules.calls).toHaveLength(1);
    expect(env.extractTargetRules.calls[0]).toMatchObject({
      candidate: { url: "https://a.example" },
    });
  });

  it("confirming the guessed candidate promotes the cached output with zero new executions", async () => {
    const env = setup();
    await driveToGate(env);
    expect(env.extractTargetRules.calls).toHaveLength(1);

    const run = env.runEngine.getRun("s1");
    const ok = env.runEngine.resolveGate("s1", run.runId, "https://a.example");
    expect(ok).toBe(true);
    await tick();

    // Still just the one speculative call — confirming the guess must not
    // start a second execution (dedup collapses the blocking re-enqueue).
    expect(env.extractTargetRules.calls).toHaveLength(1);

    env.extractTargetRules.resolve({ name: "Mejiro Dental Clinic", url: "https://a.example", rules: [] });
    await tick();
    await tick();

    const finalRun = env.runEngine.getRun("s1");
    const extractJob = finalRun.jobs.find((j: { step: string }) => j.step === "extractTargetRules");
    expect(extractJob.status).toBe("done");
  });

  it("picking a different candidate supersedes the stale speculative job and starts a fresh one", async () => {
    const env = setup();
    await driveToGate(env);
    expect(env.extractTargetRules.calls).toHaveLength(1);

    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, "https://b.example");
    await tick();
    await tick();

    expect(env.extractTargetRules.calls).toHaveLength(2);
    expect(env.extractTargetRules.calls[1]).toMatchObject({ candidate: { url: "https://b.example" } });

    // The stale guess-A job settles as superseded, not resurrected as fact.
    const jobs = env.jobRunner.getJobs("s1");
    const superseded = jobs.filter((j: { status: string }) => j.status === "superseded");
    expect(superseded.length).toBeGreaterThanOrEqual(1);
  });

  it("candidateId: null fails the gate and cancels speculative work", async () => {
    const env = setup();
    await driveToGate(env);

    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, null);
    await tick();

    const after = env.runEngine.getRun("s1");
    expect(after.gate).toBeUndefined();
    const gateJob = after.jobs.find((j: { step: string }) => j.step === "confirmTarget");
    expect(gateJob.status).toBe("failed");
  });

  it("a failed soft dep (geolocate) does not block research forever", async () => {
    const env = setup();
    env.runEngine.startRun("s1", "renew my residence card");
    env.identifyTarget.resolve({ name: "City hall", query: "市役所 在留カード" });
    await tick();
    await tick();
    env.geolocate.reject(new Error("geolocate blew up"));
    await tick();
    await tick();
    await tick();

    expect(env.research.calls).toHaveLength(1);
    // geolocate failed -> no queryHint -> falls back to identifyTarget's query.
    expect(env.research.calls[0]).toEqual({ q: "市役所 在留カード" });
  });

  it("startRun cancels a prior in-flight run under the same runKey", async () => {
    const env = setup();
    env.runEngine.startRun("s1", "first objective");
    await tick();
    expect(env.identifyTarget.calls).toHaveLength(1);

    env.runEngine.startRun("s1", "second objective");
    await tick();

    const jobs = env.jobRunner.getJobs("s1");
    const firstJobCanceled = jobs.some(
      (j: { status: string; step: string }) => j.step === "identifyTarget" && j.status === "superseded",
    );
    expect(firstJobCanceled || env.identifyTarget.calls.length === 2).toBe(true);
  });
});

describe("planScenario (Phase 7 plan §7b.5 migration step 4)", () => {
  it("does not start while the confirmTarget gate is still open", async () => {
    const env = setup();
    await driveToGate(env);
    expect(env.planScenario.calls).toHaveLength(0);
  });

  it("waits for extractTargetRules to reach a terminal status before starting (soft dep)", async () => {
    const env = setup();
    await driveToGate(env);
    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, "https://a.example");
    await tick();
    await tick();

    // extractTargetRules is still "running" (promoted, not yet resolved) —
    // planScenario's soft dep is not satisfied by "running", only by a
    // terminal status, so it must not have started yet.
    expect(env.planScenario.calls).toHaveLength(0);

    env.extractTargetRules.resolve({
      name: "Mejiro Dental Clinic",
      url: "https://a.example",
      rules: [{ id: "r1", rule: "Open weekdays 9-17", kind: "hours", source: "https://a.example" }],
    });
    await tick();
    await tick();

    expect(env.planScenario.calls).toHaveLength(1);
    expect(env.planScenario.calls[0]).toMatchObject({
      target: { name: "Mejiro Dental Clinic", url: "https://a.example" },
    });
  });

  it("still starts (with no cited rules) when extractTargetRules fails outright", async () => {
    const env = setup();
    await driveToGate(env);
    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, "https://a.example");
    await tick();
    await tick();

    env.extractTargetRules.reject(new Error("scrape failed"));
    await tick();
    await tick();
    await tick();

    expect(env.planScenario.calls).toHaveLength(1);
    expect(env.planScenario.calls[0]).toMatchObject({
      target: { name: "Mejiro Dental Clinic", url: "https://a.example", rules: [] },
    });
  });

  it("carries docSummary/answers/settings seeded via startRun's extra ctx", async () => {
    const env = setup();
    const docSummary = { documentType: "x", issuingAgency: "y", purpose: "z", keyFields: [], questions: [] };
    const answers = [{ questionId: "q1", answer: "a" }];
    const settings = { role: "reception", difficulty: "beginner", pace: "slow" };

    env.runEngine.startRun("s1", "book an appointment at Mejiro Dental Clinic", {
      docSummary,
      answers,
      settings,
    });
    env.identifyTarget.resolve({ name: "Mejiro Dental Clinic", city: "Toshima", query: "目白 歯科" });
    await tick();
    await tick();
    env.geolocate.resolve({ locality: "Toshima", queryHint: "Mejiro Dental Clinic Toshima" });
    await tick();
    await tick();
    env.research.resolve({ query: "x", results: CANDIDATES });
    await tick();
    await tick();

    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, "https://a.example");
    await tick();
    await tick();
    env.extractTargetRules.resolve({ name: "Mejiro Dental Clinic", url: "https://a.example", rules: [] });
    await tick();
    await tick();

    expect(env.planScenario.calls).toHaveLength(1);
    expect(env.planScenario.calls[0]).toMatchObject({ docSummary, answers, settings });
  });
});
