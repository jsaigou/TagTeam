/**
 * Phase 7b — step graph + run engine (Phase 7 plan §7b.3).
 *
 * The graph is DATA, not code — see `GRAPH` below — which is what makes
 * "never wrong-country info silently" (architecture principle 6) a
 * structural property instead of a UI rule: `extractTargetRules` hard-depends
 * on `confirmTarget`, so nothing downstream can use a guessed target as fact
 * without the graph itself blocking on it.
 *
 * This module composes over `server/jobs.mjs`'s flat job runner — it does not
 * replace it. `createJobRunner` stays the single place lanes/concurrency are
 * enforced (shared across this engine's steps AND any flat `enqueue()` caller
 * like the legacy `/api/search` route), and `createRunEngine` adds run-level
 * bookkeeping on top: dependency resolution, the gate pause, and speculative
 * quarantine — all keyed by the SAME (runKey, step, input) dedup jobs.mjs
 * already provides, which is what makes "confirm the guess → zero new
 * executions" and "pick another → supersede + re-enqueue" fall out for free
 * (see jobs.mjs's dedup-and-promote logic in `enqueue()`).
 *
 * One active run per runKey (an app_session id) — a fresh `startRun` cancels
 * whatever was running before it, same as a user restating their objective
 * mid-flow should supersede the old research rather than run both.
 */
import crypto from "node:crypto";

/** `"x?"` marks a soft dependency — satisfied once the node is DONE, or once
 *  it reaches any terminal non-done status (a text-only objective has no
 *  document, so a soft `parseDocument?` dep is skippable). A hard dep is only
 *  satisfied by "done". */
function parseDeps(deps) {
  return (deps ?? []).map((d) =>
    d.endsWith("?") ? { id: d.slice(0, -1), soft: true } : { id: d, soft: false },
  );
}

// "skipped" is a graph-level terminal status (never a jobs.mjs job status):
// an `enabled`-gated node whose input never materialized — e.g. a text-only
// objective has no document, so `parseDocument` skips instead of running.
// Soft deps accept it exactly like failed/canceled/superseded.
const TERMINAL_NOT_DONE = new Set(["failed", "canceled", "superseded", "skipped"]);
const TERMINAL_STATUSES = new Set(["done", "failed", "canceled", "superseded", "skipped"]);

function depsSatisfied(run, deps) {
  return parseDeps(deps).every(({ id, soft }) => {
    const node = run.nodes[id];
    if (!node) return false;
    if (node.status === "done") return true;
    return soft && TERMINAL_NOT_DONE.has(node.status);
  });
}

/**
 * The confirmTarget sub-graph (Phase 7 plan §7b.3, slice "the confirmTarget
 * gate"). `cheatSheet`/`classifyIntent` are declared in the shared JobStep
 * union (src/shared/contract.ts) but have no graph node yet — later slices
 * add them here, additively, same as the rest of Phase 7b.
 */
export const GRAPH = {
  identifyTarget: {
    deps: [],
    step: "identifyTarget",
    input: (ctx) => ({ goal: ctx.goal }),
  },
  parseDocument: {
    // Runs alongside identifyTarget from the moment a run starts — but only
    // when startRun seeded a `doc` (uploadId(s) into the ephemeral upload
    // store, or a text description). Most runs have none: `enabled` then
    // marks the node "skipped" (a terminal status soft deps accept) instead
    // of leaving it never-started, which would block planScenario's soft dep
    // forever — depsSatisfied only knows about nodes that exist.
    deps: [],
    step: "parseDocument",
    enabled: (ctx) => ctx.doc != null,
    input: (ctx) => ({ doc: ctx.doc }),
  },
  geolocate: {
    deps: ["identifyTarget"],
    step: "geolocate",
    input: (ctx) => ({ name: ctx.identifyTarget?.name, city: ctx.identifyTarget?.city }),
  },
  research: {
    // Soft dep: geolocate only enriches the query; a text-only objective (or
    // a geolocate failure) must not block research behind it.
    deps: ["identifyTarget", "geolocate?"],
    step: "research",
    input: (ctx) => ({
      q: ctx.geolocate?.queryHint || ctx.identifyTarget?.query || ctx.goal,
    }),
  },
  confirmTarget: {
    kind: "gate",
    deps: ["research"],
    label: "Is this the right place?",
    candidates: (ctx) =>
      (ctx.research?.results ?? []).slice(0, 5).map((r) => ({
        id: r.url,
        name: r.title || r.url,
        url: r.url,
        snippet: r.snippet,
      })),
  },
  extractTargetRules: {
    deps: ["confirmTarget"],
    step: "extractTargetRules",
    speculative: true,
    input: (ctx) => ({ candidate: ctx.confirmTarget }),
  },
  planScenario: {
    // Hard dep on confirmTarget (architecture principle 6 — never build a
    // practice script on an unconfirmed guess). Soft dep on
    // extractTargetRules: a failed/slow rule extraction must not block the
    // script forever — it just runs with the confirmed candidate's name/
    // address and no cited rules. Soft dep on parseDocument: it may never
    // run at all (a text-only objective skips it) or fail, and either way
    // the script falls back to the client-seeded docSummary.
    deps: ["confirmTarget", "extractTargetRules?", "parseDocument?"],
    step: "planScenario",
    input: (ctx) => ({
      docSummary: ctx.parseDocument ?? ctx.docSummary,
      answers: ctx.answers,
      settings: ctx.settings,
      preset: ctx.preset,
      target: ctx.extractTargetRules ?? (ctx.confirmTarget && { ...ctx.confirmTarget, rules: [] }),
    }),
    // The graph's deliverable: once this node completes, its result (plus the
    // confirmed target it was built from) rides every RunSnapshot as
    // `result`, so the setup screen can apply script + glossary and jump to
    // the call. The selector runs against the run's ctx — the engine stays
    // generic; WHAT gets delivered is graph data, same as deps/inputs.
    deliver: (ctx) => ({
      step: "planScenario",
      ...(ctx.planScenario ?? {}),
      target:
        ctx.extractTargetRules ?? (ctx.confirmTarget ? { ...ctx.confirmTarget, rules: [] } : null),
    }),
  },
};

/** Nodes that may speculatively run off a gate's top guess while it's open. */
function speculativeDependents(graph, gateNodeId) {
  return Object.entries(graph).filter(
    ([, def]) => def.speculative && parseDeps(def.deps).some((d) => d.id === gateNodeId),
  );
}

/**
 * @param {object} opts
 * @param {ReturnType<import("./jobs.mjs").createJobRunner>} opts.jobRunner
 * @param {typeof GRAPH} [opts.graph]
 */
export function createRunEngine({ jobRunner, graph = GRAPH } = {}) {
  if (!jobRunner) throw new Error("createRunEngine requires `jobRunner`");

  /** runKey -> Run */
  const runs = new Map();
  /** jobId -> { runKey, nodeId } — routes jobs.mjs's flat onChange back to a run. */
  const jobIndex = new Map();
  const listeners = new Set();

  function addListener(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function buildSnapshot(run) {
    const jobs = Object.entries(run.nodes)
      // A gate node has no jobs.mjs job of its own (it's a pause, not a
      // step) — every entry in run.nodes represents a real started/opened/
      // resolved node. The one exception is an `enabled`-gated node that was
      // marked "skipped" without ever starting: it's internal bookkeeping
      // for the soft-dep check, not work the status feed should show (and
      // "skipped" is not a JobStatus the contract declares).
      .filter(([, n]) => n.status !== "skipped")
      .map(([nodeId, n]) => ({
        id: n.job?.id ?? nodeId,
        step: graph[nodeId]?.step ?? nodeId,
        status: n.status ?? "queued",
        label: n.label ?? n.job?.label ?? nodeId,
        detail: n.detail,
        progress: n.progress,
        elapsedMs: n.elapsedMs,
        error: n.error,
      }));
    return {
      runId: run.runId,
      goal: run.goal,
      jobs,
      gate: run.gate
        ? { nodeId: run.gate.nodeId, candidates: run.gate.candidates, guessId: run.gate.guessId }
        : undefined,
      result: run.result,
    };
  }

  function notifyRun(run) {
    const snap = buildSnapshot(run);
    for (const fn of listeners) fn(run.runKey, snap);
  }

  function cancelNode(run, nodeId) {
    const job = run.nodes[nodeId]?.job;
    if (job) jobRunner.cancel(job, { supersede: true });
  }

  /** Enqueue `step(input)` for `nodeId` and wire its settlement back into
   *  `run.ctx` — shared by normal advancement and speculative gate guesses. */
  function attachNode(run, nodeId, step, input, priority) {
    const job = jobRunner.enqueue(run.runKey, step, input, { priority });
    jobIndex.set(job.id, { runKey: run.runKey, nodeId });
    run.nodes[nodeId] = { ...run.nodes[nodeId], job, status: job.status };
    job.settled
      .then((result) => {
        // A later resolveGate may have already superseded this exact job
        // with a fresh one for a different candidate — only the CURRENT
        // job for this node is allowed to write the run's context.
        if (run.nodes[nodeId]?.job !== job) return;
        run.ctx[nodeId] = result;
        run.nodes[nodeId].status = "done";
        if (typeof graph[nodeId]?.deliver === "function") {
          run.result = graph[nodeId].deliver(run.ctx);
        }
        notifyRun(run);
        tryAdvance(run);
      })
      .catch(() => {
        /* terminal status already reflected via jobRunner's onChange -> jobIndex path */
      });
    return job;
  }

  function startNode(run, nodeId, def, { priority }) {
    const input = def.input ? def.input(run.ctx) : run.ctx;
    return attachNode(run, nodeId, def.step ?? nodeId, input, priority);
  }

  function openGate(run, nodeId, def) {
    const candidates = def.candidates(run.ctx);
    const guessId = candidates[0]?.id;
    run.gate = { nodeId, candidates, guessId };
    run.nodes[nodeId] = { status: "needs_input", label: def.label ?? nodeId };
    notifyRun(run);
    if (guessId) {
      // `run.ctx` has no entry for the gate node yet (it's still open) — the
      // guess is substituted in locally so e.g. extractTargetRules gets a URL,
      // WITHOUT writing it to run.ctx (quarantined: never treated as fact
      // until resolveGate actually confirms it).
      const ctxWithGuess = { ...run.ctx, [nodeId]: candidates[0] };
      for (const [depId, depDef] of speculativeDependents(graph, nodeId)) {
        const input = depDef.input ? depDef.input(ctxWithGuess) : ctxWithGuess;
        attachNode(run, depId, depDef.step ?? depId, input, "speculative");
      }
    }
  }

  function tryAdvance(run) {
    for (const [nodeId, def] of Object.entries(graph)) {
      if (run.nodes[nodeId]) continue; // already started/opened/skipped
      if (!depsSatisfied(run, def.deps)) continue;
      if (def.enabled && !def.enabled(run.ctx)) {
        // Nothing for this node to ever do (its input never materialized,
        // e.g. a run with no document). Mark it terminal-skipped so soft
        // dependents see a settled status instead of waiting on a node that
        // will never start. Never re-considered: run.nodes[nodeId] now
        // exists, so the loop above passes over it.
        run.nodes[nodeId] = { status: "skipped" };
        continue;
      }
      if (def.kind === "gate") {
        openGate(run, nodeId, def);
      } else {
        startNode(run, nodeId, def, { priority: "blocking" });
      }
    }
  }

  /** Route a jobs.mjs snapshot (queued/running/progress/terminal) to its run. */
  jobRunner.addListener((jobSnap) => {
    const loc = jobIndex.get(jobSnap.id);
    if (!loc) return;
    // No more snapshots will ever follow a terminal one for this job id —
    // drop it now so jobIndex doesn't grow unbounded across a long-lived run.
    if (TERMINAL_STATUSES.has(jobSnap.status)) jobIndex.delete(jobSnap.id);
    const run = runs.get(loc.runKey);
    if (!run) return;
    const node = run.nodes[loc.nodeId];
    // A superseded stale job's late snapshot must not resurrect a node that
    // has already moved on to a fresh job (or been overwritten by resolveGate).
    if (!node || node.job?.id !== jobSnap.id) return;
    node.status = jobSnap.status;
    node.label = jobSnap.label;
    node.detail = jobSnap.detail;
    node.progress = jobSnap.progress;
    node.elapsedMs = jobSnap.elapsedMs;
    node.error = jobSnap.error;
    notifyRun(run);
    // A node that failed/canceled/superseded still needs tryAdvance() so any
    // dependent with a SOFT dep on it (e.g. research on "geolocate?") gets
    // re-checked — the success path already re-advances via attachNode's
    // `.then`, but nothing else calls it on a terminal non-done status.
    if (TERMINAL_STATUSES.has(jobSnap.status) && jobSnap.status !== "done") tryAdvance(run);
  });

  // `extra` seeds ctx fields no graph node produces (docSummary/answers/
  // settings/preset — the setup-screen document/grounding state, which the
  // intent-message UI rides on the `intent` message's `context` field — and
  // `doc`, the parseDocument step's input: uploadId(s) already in the
  // server's upload store, or a text description). Additive: every existing
  // 2-arg call site (e.g. hub.mjs's `startRun(sessionId, objective)`) still
  // works unchanged.
  function startRun(runKey, goal, extra = {}) {
    if (runs.has(runKey)) jobRunner.cancelRun(runKey);
    const run = {
      runId: crypto.randomUUID(),
      runKey,
      goal,
      ctx: { goal, ...extra },
      nodes: {},
      gate: undefined,
      result: undefined,
    };
    runs.set(runKey, run);
    notifyRun(run);
    tryAdvance(run);
    return buildSnapshot(run);
  }

  /** `candidateId: null` = none of the candidates match; the gate closes
   *  failed and the caller must `startRun` again with a better objective. */
  function resolveGate(runKey, runId, candidateId) {
    const run = runs.get(runKey);
    if (!run || run.runId !== runId || !run.gate) return false;
    const nodeId = run.gate.nodeId;
    const dependents = speculativeDependents(graph, nodeId);

    if (candidateId === null) {
      for (const [depId] of dependents) cancelNode(run, depId);
      run.nodes[nodeId] = { status: "failed", error: { message: "No candidate confirmed" } };
      run.gate = undefined;
      notifyRun(run);
      return true;
    }

    const candidate = run.gate.candidates.find((c) => c.id === candidateId);
    if (!candidate) return false;

    run.ctx[nodeId] = candidate;
    run.nodes[nodeId] = { status: "done" };
    run.gate = undefined;
    notifyRun(run);

    for (const [depId, depDef] of dependents) {
      const staleJob = run.nodes[depId]?.job ?? null;
      startNode(run, depId, depDef, { priority: "blocking" });
      const newJob = run.nodes[depId].job;
      // Same candidate as the guess -> same dedup key -> jobs.mjs returns the
      // SAME job (now promoted to blocking): zero new executions. A
      // different candidate -> different input -> a fresh job; abort the now
      // -irrelevant guess so it doesn't waste an LLM/net-lane slot.
      if (staleJob && staleJob !== newJob) jobRunner.cancel(staleJob, { supersede: true });
    }

    tryAdvance(run);
    return true;
  }

  function cancelRun(runKey, runId) {
    const run = runs.get(runKey);
    if (!run || run.runId !== runId) return false;
    jobRunner.cancelRun(runKey);
    // Emit ONE final snapshot with the in-flight nodes marked canceled before
    // dropping the run — the jobs' own terminal snapshots arrive AFTER
    // runs.delete() and are discarded (no run to route them to), so without
    // this a subscribed UI would sit on a stale "running" feed forever.
    for (const node of Object.values(run.nodes)) {
      if (!TERMINAL_STATUSES.has(node.status ?? "queued")) node.status = "canceled";
    }
    run.gate = undefined;
    notifyRun(run);
    runs.delete(runKey);
    return true;
  }

  /** Drop a session's run without requiring its runId (room teardown). */
  function endSession(runKey) {
    if (!runs.has(runKey)) return;
    jobRunner.cancelRun(runKey);
    runs.delete(runKey);
  }

  function getRun(runKey) {
    const run = runs.get(runKey);
    return run ? buildSnapshot(run) : null;
  }

  return { startRun, resolveGate, cancelRun, endSession, getRun, addListener };
}
