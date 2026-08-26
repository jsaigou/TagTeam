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
// Pure URL extraction shared with the research step — graph.mjs shapes node
// INPUTS from ctx (data), and the user's raw links are input-shaping, not
// step logic.
import { extractUrls } from "./steps/research.mjs";

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
 * The confirmTarget sub-graph (Phase 7 plan §7b.3). `classifyIntent` is
 * declared in the shared JobStep union (src/shared/contract.ts) but is not a
 * graph node — it's the hub's message classifier (server/intent.mjs), not a
 * step. Later slices add further nodes additively, same as the rest of 7b.
 */
export const GRAPH = {
  // A link pasted into the goal is fetched FIRST so identifyTarget reads the
  // actual page (issue: "if I just give a url, infer my goal from its
  // content") instead of guessing a business from a domain string. Reuses
  // the scrape step (SSRF-guarded); research later receives the same page as
  // `prescraped` so it is fetched exactly once per run. Fails soft: a dead
  // link only costs the page-grounding, and identifyTarget's `readUrl?` dep
  // accepts the failure.
  readUrl: {
    deps: [],
    step: "scrape",
    enabled: (ctx) => extractUrls(ctx.goal).length > 0,
    input: (ctx) => ({ url: extractUrls(ctx.goal)[0] }),
  },
  identifyTarget: {
    deps: ["readUrl?"],
    step: "identifyTarget",
    input: (ctx) => ({ goal: ctx.goal, page: ctx.readUrl ?? null }),
    // A bare-URL run's goal starts as the raw link; once the target is
    // identified FROM that page, snapshots carry the inferred errand instead
    // ("目白台デンタルクリニックの予約変更"), which is what the UI shows.
    refineGoal: (result) => result?.objective ?? null,
  },
  // Sprint 1 (Switchboard Plan) — runs off the raw goal, in parallel with
  // identifyTarget/research, so its result is ready by the time planScenario
  // needs it. A soft dep on planScenario (below): a slow/failed
  // classification must not block script generation forever — it just falls
  // back to full generation, same as an unclassifiable objective always has.
  classifyScenario: {
    deps: [],
    step: "classifyScenario",
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
    input: (ctx) => ({
      name: ctx.identifyTarget?.name,
      city: ctx.identifyTarget?.city,
      // identifyTarget's LLM-crafted Japanese query — geolocate prefers it
      // over the raw name when composing the search hint (a romanized name
      // searches poorly on ja-JP SearXNG).
      query: ctx.identifyTarget?.query,
    }),
  },
  research: {
    // Soft dep: geolocate only enriches the query; a text-only objective (or
    // a geolocate failure) must not block research behind it.
    deps: ["identifyTarget", "geolocate?"],
    step: "research",
    input: (ctx) => ({
      q: ctx.geolocate?.queryHint || ctx.identifyTarget?.query || ctx.goal,
      // The user's own links, extracted from the RAW goal — identifyTarget/
      // geolocate rewrite `q`, and a URL must never be lost to that rewrite
      // (that regression made pasted links get SEARCHED as domain-derived
      // names instead of fetched). Scraped pages become `via: "user-url"`
      // candidates that confirmTarget auto-confirms.
      urls: extractUrls(ctx.goal),
      // readUrl already fetched the first link for page-grounding; reuse it
      // instead of a second scrape round-trip.
      prescraped: ctx.readUrl ? [ctx.readUrl] : undefined,
      // Reranks hits against the identified name (+ its romanized alias) so
      // the official site outranks listicles / same-name clinics elsewhere.
      name: ctx.identifyTarget?.name,
      alias: ctx.identifyTarget?.alias,
    }),
  },
  confirmTarget: {
    kind: "gate",
    deps: ["research"],
    // Sprint 2 — "generic or specific?" flow: when the user opts for generic
    // practice, skip the entire research/gate/extractTargetRules sub-graph.
    // planScenario falls back to identifyTarget's result (name + city) as the
    // target — no web confirmation needed.
    enabled: (ctx) => !ctx.skipResearch,
    label: "Is this the right place?",
    candidates: (ctx) =>
      (ctx.research?.results ?? []).slice(0, 5).map((r) => ({
        id: r.url,
        name: r.title || r.url,
        url: r.url,
        snippet: r.snippet,
        via: r.via,
      })),
    // A page the USER pasted is not a guess — asking "is this the right
    // place?" about their own link reads as broken. If research produced a
    // `via: "user-url"` result (their link, scraped), the gate resolves
    // itself to it instead of pausing. When the direct scrape failed, no
    // such candidate exists and the gate degrades to the normal ask flow.
    autoConfirm: (ctx) => {
      const direct = (ctx.research?.results ?? []).find((r) => r.via === "user-url");
      return direct ? direct.url : null;
    },
  },
  extractTargetRules: {
    deps: ["confirmTarget"],
    step: "extractTargetRules",
    speculative: true,
    // Sprint 2 — skip when the user chose generic practice (confirmTarget
    // is already skipped, but this makes the intent explicit).
    enabled: (ctx) => !ctx.skipResearch,
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
    // Sprint 2 — confirmTarget is soft: when skipped (generic practice),
    // identifyTarget's result provides the target name/city.
    deps: ["confirmTarget?", "extractTargetRules?", "parseDocument?", "classifyScenario?"],
    step: "planScenario",
    input: (ctx) => ({
      docSummary: ctx.parseDocument ?? ctx.docSummary,
      answers: ctx.answers,
      settings: ctx.settings,
      preset: ctx.preset,
      // A URL-only run's goal was refined by identifyTarget into the actual
      // errand inferred from the page — script from THAT, not the raw link.
      goal: ctx.identifyTarget?.objective || ctx.goal,
      // Sprint 2 — when confirmTarget was skipped (generic practice), fall
      // back to identifyTarget's result as the target. The script generator
      // gets the office name/city without web-confirmed rules.
      target:
        ctx.extractTargetRules ??
        (ctx.confirmTarget
          ? { ...ctx.confirmTarget, rules: [] }
          : ctx.identifyTarget
            ? { name: ctx.identifyTarget.name, city: ctx.identifyTarget.city, rules: [] }
            : null),
      // Sprint 1's fast path — see planScenario.mjs's ASSEMBLY_CONFIDENCE_THRESHOLD.
      // Soft dep above means this may be absent (still running/failed/skipped)
      // when planScenario starts; undefined leafId just falls through to
      // full generation, same as always.
      leafId: ctx.classifyScenario?.leafId ?? null,
      confidence: ctx.classifyScenario?.confidence,
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
        ctx.extractTargetRules ??
        (ctx.confirmTarget
          ? { ...ctx.confirmTarget, rules: [] }
          : ctx.identifyTarget
            ? { name: ctx.identifyTarget.name, city: ctx.identifyTarget.city, rules: [] }
            : null),
    }),
  },
  cheatSheet: {
    // Phase 7 plan §7b.5 migration step 7 — generated SPECULATIVELY while the
    // user rehearses, so the sheet is ready before they press Finish instead
    // of a fresh blocking LLM call at the end. `speculative` here means lane
    // priority (behind Luna's blocking chat turns in the concurrency-1 llm
    // lane), NOT gate-quarantine speculation: its hard dep is planScenario,
    // which itself sits behind the confirmTarget gate, so nothing unconfirmed
    // can reach it. A failed/canceled sheet never fails the run — the client
    // keeps its Finish-time generation as fallback.
    deps: ["planScenario"],
    step: "cheatSheet",
    speculative: true,
    input: (ctx) => ({
      script: ctx.planScenario?.script,
      glossary: ctx.planScenario?.glossary,
      answers: ctx.answers,
      target:
        ctx.extractTargetRules ??
        (ctx.confirmTarget
          ? { ...ctx.confirmTarget, rules: [] }
          : ctx.identifyTarget
            ? { name: ctx.identifyTarget.name, city: ctx.identifyTarget.city, rules: [] }
            : null),
    }),
    // Merged into RunSnapshot.result alongside planScenario's delivery (see
    // attachNode) so one snapshot carries script+glossary+target AND sheet.
    deliver: (ctx) => ({ step: "cheatSheet", cheatSheet: ctx.cheatSheet ?? null }),
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
        // A node may refine the run's human-facing goal (identifyTarget
        // infers the actual errand from a pasted page). Applied BEFORE the
        // snapshot so the UI shows "目白台デンタルクリニックの予約変更", not the raw link.
        if (typeof graph[nodeId]?.refineGoal === "function") {
          const refined = graph[nodeId].refineGoal(result);
          if (typeof refined === "string" && refined.trim()) run.goal = refined.trim();
        }
        if (typeof graph[nodeId]?.deliver === "function") {
          // MERGE, not replace: multiple deliver steps (planScenario's
          // script+glossary+target, cheatSheet's sheet) accumulate into one
          // RunSnapshot.result. Later completions win per-field; a deliver
          // step that never completes simply leaves the earlier fields in.
          run.result = { ...run.result, ...graph[nodeId].deliver(run.ctx) };
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

  /** Commit `candidate` as the gate node's settled fact and (re)start its
   *  speculative dependents at blocking priority. Shared by resolveGate's
   *  user-confirmed path AND openGate's autoConfirm path — the only
   *  difference between them is whether the guess jobs already exist
   *  (resolveGate supersedes stale guesses; auto-confirm has none yet). */
  function settleGate(run, nodeId, candidate) {
    run.ctx[nodeId] = candidate;
    run.nodes[nodeId] = { status: "done", label: graph[nodeId]?.label ?? nodeId };
    run.gate = undefined;
    notifyRun(run);

    for (const [depId, depDef] of speculativeDependents(graph, nodeId)) {
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
  }

  function openGate(run, nodeId, def) {
    const candidates = def.candidates(run.ctx);
    // An empty candidate list can never be confirmed — opening the gate would
    // strand the run forever (the only button is "None of these", which
    // hard-fails it). Fail the node immediately with actionable copy.
    if (candidates.length === 0) {
      run.nodes[nodeId] = {
        status: "failed",
        label: def.label ?? nodeId,
        error: {
          message:
            "No web results to confirm — restate your objective with more detail, or add a document.",
        },
      };
      notifyRun(run);
      return;
    }
    const guessId = candidates[0]?.id;

    // Auto-confirm (e.g. a user-pasted URL that research scraped directly):
    // the candidate is the user's own input, not a guess — settle the gate
    // immediately instead of pausing for an answer that reads as broken.
    const autoConfirmId = def.autoConfirm?.(run.ctx) ?? null;
    if (autoConfirmId != null && candidates.some((c) => c.id === autoConfirmId)) {
      settleGate(run, nodeId, candidates.find((c) => c.id === autoConfirmId));
      return;
    }

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
        // A `speculative` node (e.g. cheatSheet) starts at speculative lane
        // priority — it must never delay Luna's blocking chat turns in the
        // concurrency-1 llm lane. Everything else is blocking.
        startNode(run, nodeId, def, { priority: def.speculative ? "speculative" : "blocking" });
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
    // "done" is deliberately NOT applied here. jobs.mjs's execute() calls
    // notify(job) (which reaches this listener synchronously) BEFORE
    // job._resolve(result) — so a "done" snapshot can arrive here a full
    // microtask before attachNode's `.then()` sets run.ctx[nodeId]. If a
    // DIFFERENT node's `.then()`-triggered tryAdvance() interleaves in that
    // gap, it would see this node as "done" with its ctx entry still unset
    // — e.g. confirmTarget reading an undefined ctx.research and opening
    // with zero candidates. attachNode's `.then()` is the only place
    // allowed to set "done", atomically together with ctx — same discipline
    // the "don't tryAdvance on done here" comment below already establishes
    // for this exact reason, now applied to the status write too.
    if (jobSnap.status !== "done") node.status = jobSnap.status;
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

    if (candidateId === null) {
      for (const [depId] of speculativeDependents(graph, nodeId)) cancelNode(run, depId);
      run.nodes[nodeId] = { status: "failed", error: { message: "No candidate confirmed" } };
      run.gate = undefined;
      notifyRun(run);
      return true;
    }

    const candidate = run.gate.candidates.find((c) => c.id === candidateId);
    if (!candidate) return false;

    settleGate(run, nodeId, candidate);
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
