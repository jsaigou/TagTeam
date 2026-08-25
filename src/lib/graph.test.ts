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
  const parseDocument = controllableStep();
  const geolocate = controllableStep();
  const research = controllableStep();
  const extractTargetRules = controllableStep();
  const planScenario = controllableStep();
  const cheatSheet = controllableStep();
  const classifyScenario = controllableStep();

  const jobRunner = createJobRunner({
    steps: {
      identifyTarget: { run: identifyTarget.run, lane: "llm" },
      parseDocument: { run: parseDocument.run, lane: "llm" },
      geolocate: { run: geolocate.run },
      research: { run: research.run, lane: "net" },
      extractTargetRules: { run: extractTargetRules.run, lane: "llm" },
      planScenario: { run: planScenario.run, lane: "llm" },
      cheatSheet: { run: cheatSheet.run, lane: "llm" },
      classifyScenario: { run: classifyScenario.run, lane: "llm" },
    },
  });

  const snapshots: unknown[] = [];
  const runEngine = createRunEngine({ jobRunner });
  runEngine.addListener((_runKey: string, run: unknown) => snapshots.push(run));

  return {
    jobRunner,
    runEngine,
    identifyTarget,
    parseDocument,
    geolocate,
    research,
    extractTargetRules,
    planScenario,
    cheatSheet,
    classifyScenario,
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
  // classifyScenario shares the "llm" lane (concurrency 1, same as
  // production — there's only one real model to call) with identifyTarget,
  // so its job doesn't start running until identifyTarget's clears; resolve
  // it here, not before. A neutral, non-fast-path classification —
  // planScenario's soft dep just needs SOME terminal status; the fast-path
  // behavior itself is covered by server/plan-scenario.test.ts.
  env.classifyScenario.resolve({ leafId: null });
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
    expect(GRAPH.planScenario.deps).toEqual([
      "confirmTarget",
      "extractTargetRules?",
      "parseDocument?",
      "classifyScenario?",
    ]);
  });

  it("declares parseDocument as a dep-free node gated on a seeded doc", () => {
    expect(GRAPH.parseDocument.deps).toEqual([]);
    expect(GRAPH.parseDocument.step).toBe("parseDocument");
    expect(GRAPH.parseDocument.enabled({ doc: { kind: "text", text: "x" } })).toBe(true);
    expect(GRAPH.parseDocument.enabled({})).toBe(false);
    expect(GRAPH.parseDocument.input({ doc: { kind: "text", text: "x" } })).toEqual({
      doc: { kind: "text", text: "x" },
    });
  });

  it("declares planScenario as the graph's deliverable", () => {
    expect(typeof GRAPH.planScenario.deliver).toBe("function");
  });

  it("declares cheatSheet as a speculative deliver step behind planScenario (§7b.5 step 7)", () => {
    expect(GRAPH.cheatSheet.deps).toEqual(["planScenario"]);
    expect(GRAPH.cheatSheet.step).toBe("cheatSheet");
    expect(GRAPH.cheatSheet.speculative).toBe(true);
    expect(typeof GRAPH.cheatSheet.deliver).toBe("function");
  });
});

describe("createRunEngine", () => {
  it("advances identifyTarget -> geolocate -> research -> opens the confirmTarget gate", async () => {
    const env = setup();
    await driveToGate(env);

    expect(env.identifyTarget.calls).toEqual([
      { goal: "book an appointment at Mejiro Dental Clinic", page: null },
    ]);
    expect(env.geolocate.calls).toEqual([
      { name: "Mejiro Dental Clinic", city: "Toshima", query: "目白 歯科" },
    ]);
    expect(env.research.calls).toEqual([
      {
        q: "Mejiro Dental Clinic Toshima",
        urls: [],
        prescraped: undefined,
        name: "Mejiro Dental Clinic",
        alias: undefined,
      },
    ]);

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
    expect(env.research.calls[0]).toEqual({
      q: "市役所 在留カード",
      urls: [],
      prescraped: undefined,
      name: "City hall",
      alias: undefined,
    });
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

  it("cancelRun emits a final snapshot with in-flight nodes canceled (UI never sits on a stale feed)", async () => {
    const env = setup();
    env.runEngine.startRun("s1", "book an appointment at Mejiro Dental Clinic");
    await tick();
    const run = env.runEngine.getRun("s1");
    expect(run.jobs.find((j: { step: string }) => j.step === "identifyTarget")).toBeDefined();

    const before = env.snapshots.length;
    env.runEngine.cancelRun("s1", run.runId);

    // The LAST broadcast marks the live nodes canceled — the jobs' own late
    // terminal snapshots are discarded (the run is already dropped), so this
    // notification is the UI's only signal.
    const last = env.snapshots[env.snapshots.length - 1] as { jobs: Array<{ status: string }> };
    expect(env.snapshots.length).toBeGreaterThan(before);
    expect(last.jobs.every((j) => ["canceled", "done", "failed", "superseded", "skipped"].includes(j.status))).toBe(
      true,
    );
    expect(env.runEngine.getRun("s1")).toBeNull();
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
    // classifyScenario shares the "llm" lane with identifyTarget — see
    // driveToGate's comment on why this resolves after identifyTarget, not
    // alongside it.
    env.classifyScenario.resolve({ leafId: null });
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

describe("parseDocument (Phase 7 plan §7b.5 migration step 5)", () => {
  const DOC = { kind: "image", uploadId: "u1" };
  const SEED_SUMMARY = { documentType: "seeded", issuingAgency: "s", purpose: "p", keyFields: [], questions: [] };
  const PARSED_SUMMARY = { documentType: "parsed", issuingAgency: "p", purpose: "p", keyFields: [], questions: [] };

  it("starts immediately at startRun (no deps) when a doc is seeded", async () => {
    const env = setup();
    env.runEngine.startRun("s1", "book an appointment at Mejiro Dental Clinic", { doc: DOC });
    await tick();

    // Enqueued in the very first advance, alongside identifyTarget (it sits
    // "queued" behind it only because the llm lane serializes by default).
    const jobs = env.jobRunner.getJobs("s1");
    expect(jobs.find((j: { step: string }) => j.step === "parseDocument")).toMatchObject({
      step: "parseDocument",
      status: "queued",
    });

    env.identifyTarget.resolve({ name: "Mejiro Dental Clinic", city: "Toshima", query: "目白 歯科" });
    await tick();
    await tick();
    // classifyScenario is also queued behind identifyTarget on the same llm
    // lane, ahead of parseDocument — it has to clear first before
    // parseDocument's job actually starts running.
    env.classifyScenario.resolve({ leafId: null });
    await tick();
    await tick();

    expect(env.parseDocument.calls).toEqual([{ doc: DOC }]);
  });

  it("never runs when no doc is seeded, and the skipped node stays out of the feed", async () => {
    const env = setup();
    await driveToGate(env);

    expect(env.parseDocument.calls).toHaveLength(0);
    const run = env.runEngine.getRun("s1");
    // The node was marked "skipped" internally — buildSnapshot filters it.
    expect(run.jobs.find((j: { step: string }) => j.step === "parseDocument")).toBeUndefined();
  });

  it("planScenario still starts when ctx.doc is absent (soft dep on a never-started node)", async () => {
    const env = setup();
    await driveToGate(env);
    expect(env.parseDocument.calls).toHaveLength(0);

    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, "https://a.example");
    await tick();
    await tick();
    env.extractTargetRules.resolve({ name: "Mejiro Dental Clinic", url: "https://a.example", rules: [] });
    await tick();
    await tick();

    // The whole point of the "skipped" terminal status: a parseDocument that
    // never started must not block the soft dep forever.
    expect(env.planScenario.calls).toHaveLength(1);
  });

  it("planScenario's docSummary comes from the parseDocument result when it completed", async () => {
    const env = setup();
    env.runEngine.startRun("s1", "book an appointment at Mejiro Dental Clinic", {
      doc: DOC,
      docSummary: SEED_SUMMARY,
    });
    env.identifyTarget.resolve({ name: "Mejiro Dental Clinic", city: "Toshima", query: "目白 歯科" });
    await tick();
    await tick();
    // classifyScenario is queued behind identifyTarget, ahead of
    // parseDocument, on the same llm lane — must clear first.
    env.classifyScenario.resolve({ leafId: null });
    await tick();
    await tick();
    env.parseDocument.resolve(PARSED_SUMMARY);
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
    expect(env.planScenario.calls[0]).toMatchObject({ docSummary: PARSED_SUMMARY });
  });

  it("planScenario falls back to the extra-seeded docSummary when parseDocument fails", async () => {
    const env = setup();
    env.runEngine.startRun("s1", "book an appointment at Mejiro Dental Clinic", {
      doc: DOC,
      docSummary: SEED_SUMMARY,
    });
    env.identifyTarget.resolve({ name: "Mejiro Dental Clinic", city: "Toshima", query: "目白 歯科" });
    await tick();
    await tick();
    // classifyScenario is queued behind identifyTarget, ahead of
    // parseDocument, on the same llm lane — must clear first.
    env.classifyScenario.resolve({ leafId: null });
    await tick();
    await tick();
    env.parseDocument.reject(new Error("Upload not found or expired — please try again."));
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
    await tick();

    // A FAILED parseDocument is a terminal status the soft dep accepts, and
    // the failure is real work — unlike "skipped", it shows in the feed.
    const finalRun = env.runEngine.getRun("s1");
    expect(finalRun.jobs.find((j: { step: string }) => j.step === "parseDocument")).toMatchObject({
      status: "failed",
    });
    expect(env.planScenario.calls).toHaveLength(1);
    expect(env.planScenario.calls[0]).toMatchObject({ docSummary: SEED_SUMMARY });
  });
});

describe("deliver (planScenario's result rides the RunSnapshot)", () => {
  const SCRIPT = { scenarioTitle: "Dental appointment", turns: [] };
  const GLOSSARY = [{ id: "g1", word: "予約", definition: "appointment" }];
  const RULES = [{ id: "r1", rule: "Open weekdays 9-17", kind: "hours", source: "https://a.example" }];

  async function confirmAndExtract(env: ReturnType<typeof setup>, { failExtract = false } = {}) {
    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, "https://a.example");
    await tick();
    await tick();
    if (failExtract) env.extractTargetRules.reject(new Error("scrape failed"));
    else
      env.extractTargetRules.resolve({
        name: "Mejiro Dental Clinic",
        url: "https://a.example",
        rules: RULES,
      });
    await tick();
    await tick();
    await tick();
  }

  it("no result while the run is in flight; delivered once planScenario completes", async () => {
    const env = setup();
    await driveToGate(env);
    expect(env.runEngine.getRun("s1").result).toBeUndefined();

    await confirmAndExtract(env);
    expect(env.runEngine.getRun("s1").result).toBeUndefined();

    env.planScenario.resolve({ script: SCRIPT, glossary: GLOSSARY });
    await tick();
    await tick();

    const finalRun = env.runEngine.getRun("s1");
    expect(finalRun.result).toMatchObject({ step: "planScenario", script: SCRIPT, glossary: GLOSSARY });
    // The confirmed target it was built from rides along (rules intact).
    expect(finalRun.result.target).toMatchObject({ name: "Mejiro Dental Clinic", rules: RULES });

    // …and the delivered result is on the broadcast snapshots too, from the
    // moment of completion on.
    const last = env.snapshots[env.snapshots.length - 1] as { result?: unknown };
    expect(last.result).toMatchObject({ step: "planScenario" });
  });

  it("falls back to the confirmed candidate (empty rules) when extractTargetRules failed", async () => {
    const env = setup();
    await driveToGate(env);
    await confirmAndExtract(env, { failExtract: true });

    env.planScenario.resolve({ script: SCRIPT, glossary: GLOSSARY });
    await tick();
    await tick();

    const finalRun = env.runEngine.getRun("s1");
    expect(finalRun.result.target).toMatchObject({
      name: "Mejiro Dental Clinic",
      url: "https://a.example",
      rules: [],
    });
  });

  it("restating the objective (a fresh run) clears a previously delivered result", async () => {
    const env = setup();
    await driveToGate(env);
    await confirmAndExtract(env);
    env.planScenario.resolve({ script: SCRIPT, glossary: GLOSSARY });
    await tick();
    await tick();
    expect(env.runEngine.getRun("s1").result).toBeDefined();

    env.runEngine.startRun("s1", "actually, book it at the city office instead");
    await tick();
    expect(env.runEngine.getRun("s1").result).toBeUndefined();
  });
});

describe("cheatSheet (Phase 7 plan §7b.5 migration step 7)", () => {
  const SCRIPT = { scenarioTitle: "Dental appointment", turns: [] };
  const GLOSSARY = [{ id: "g1", word: "予約", definition: "appointment" }];
  const RULES = [{ id: "r1", rule: "Open weekdays 9-17", kind: "hours", source: "https://a.example" }];
  const SHEET = {
    goal: "Book a dental appointment.",
    keyPhrases: [
      { jp: "予約をお願いします", furigana: "よやくをおねがいします", en: "I'd like to book an appointment", when: "if they answer" },
    ],
    practice: ["Say the clinic name clearly"],
  };

  /** Drive past planScenario's completion so the speculative sheet node fires. */
  async function drivePastPlan(env: ReturnType<typeof setup>, { failExtract = false } = {}) {
    await driveToGate(env);
    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, "https://a.example");
    await tick();
    await tick();
    if (failExtract) env.extractTargetRules.reject(new Error("scrape failed"));
    else
      env.extractTargetRules.resolve({
        name: "Mejiro Dental Clinic",
        url: "https://a.example",
        rules: RULES,
      });
    await tick();
    await tick();
    await tick();
    expect(env.planScenario.calls).toHaveLength(1);
    env.planScenario.resolve({ script: SCRIPT, glossary: GLOSSARY });
    await tick();
    await tick();
  }

  it("starts speculatively the moment planScenario delivers, fed by its output", async () => {
    const env = setup();
    await drivePastPlan(env);

    // The whole point of slice 7: the sheet is generated WHILE the user
    // rehearses, at speculative priority so it can't delay Luna's blocking
    // chat turns in the concurrency-1 llm lane.
    expect(env.cheatSheet.calls).toHaveLength(1);
    expect(env.cheatSheet.calls[0]).toMatchObject({
      script: SCRIPT,
      glossary: GLOSSARY,
      target: { name: "Mejiro Dental Clinic", url: "https://a.example", rules: RULES },
    });
    const jobs = env.jobRunner.getJobs("s1");
    expect(jobs.find((j: { step: string }) => j.step === "cheatSheet")).toMatchObject({
      priority: "speculative",
      status: "running",
    });
  });

  it("never starts before planScenario completes (hard dep)", async () => {
    const env = setup();
    await driveToGate(env);
    const run = env.runEngine.getRun("s1");
    env.runEngine.resolveGate("s1", run.runId, "https://a.example");
    await tick();
    await tick();

    // Even with everything else settled, an unfinished planScenario means no
    // sheet input exists yet.
    env.extractTargetRules.resolve({ name: "Mejiro Dental Clinic", url: "https://a.example", rules: RULES });
    await tick();
    await tick();
    expect(env.cheatSheet.calls).toHaveLength(0);
  });

  it("merges its sheet into RunSnapshot.result without dropping the delivered scenario", async () => {
    const env = setup();
    await drivePastPlan(env);

    const before = env.runEngine.getRun("s1").result;
    expect(before).toMatchObject({ step: "planScenario", script: SCRIPT, glossary: GLOSSARY });

    env.cheatSheet.resolve(SHEET);
    await tick();
    await tick();

    const finalRun = env.runEngine.getRun("s1");
    // Merge, not replace: script + glossary + target AND the sheet, in ONE snapshot.
    expect(finalRun.result).toMatchObject({
      script: SCRIPT,
      glossary: GLOSSARY,
      target: { name: "Mejiro Dental Clinic", rules: RULES },
      cheatSheet: SHEET,
    });

    // …and on the broadcast snapshots too.
    const last = env.snapshots[env.snapshots.length - 1] as { result?: { cheatSheet?: unknown } };
    expect(last.result?.cheatSheet).toMatchObject(SHEET);
  });

  it("a failed sheet never fails the run nor disturbs the delivered scenario (Finish-time fallback stays)", async () => {
    const env = setup();
    await drivePastPlan(env);

    env.cheatSheet.reject(new Error("LLM returned garbage"));
    await tick();
    await tick();
    await tick();

    const finalRun = env.runEngine.getRun("s1");
    expect(finalRun.result).toMatchObject({ script: SCRIPT, glossary: GLOSSARY });
    expect(finalRun.jobs.find((j: { step: string }) => j.step === "cheatSheet")).toMatchObject({
      status: "failed",
    });
  });
});
