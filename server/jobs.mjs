/**
 * Phase 7b — generic background job runner (server-side, in-memory).
 *
 * Replaces "the browser waits on one long request" with "the server runs a
 * named step in the background and reports progress" — see the Phase 7
 * plan §7b.1. A job is one execution of a registered `step` with some
 * `input`, grouped under a caller-supplied `runKey` (an app_session id for
 * session-scoped work; any stable string otherwise).
 *
 * Jobs are organized into named lanes, each with its own concurrency limit
 * (e.g. an "llm" lane at concurrency 1 — the deployed homelab LLM serializes
 * anyway; queueing *here* instead of letting client-side timeouts discover
 * that the hard way was the whole point of this phase — see AGENTS.md on
 * why a single call legitimately takes 40-80s). Within a lane, "blocking"
 * jobs run before "speculative" ones, then FIFO.
 *
 * Jobs are deduplicated by (runKey, step, stable-stringified input) — two
 * enqueues of the same triple share one execution and one result. That is
 * what makes speculative execution cheap: a guessed research call and the
 * later confirmed one collapse into a single job when they agree.
 *
 * Deadlines are per *attempt*, and the attempt clock starts when the step
 * actually begins running, never when it is enqueued — queue wait is never
 * counted against a job's own budget. A step is retried once on a
 * validation-style failure (it threw for a reason other than the deadline
 * or an external cancel); a timeout or a cancel is never retried — a model
 * that took the full budget will take it again.
 */
import crypto from "node:crypto";

export const JOB_TTL_MS = 4 * 60 * 60 * 1000;

const TERMINAL_STATUSES = new Set(["done", "failed", "canceled", "superseded"]);

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function dedupKey(step, input) {
  return `${step}:${stableStringify(input ?? null)}`;
}

function priorityRank(job) {
  return job.priority === "blocking" ? 0 : 1;
}

/**
 * @param {object} opts
 * @param {Record<string, { lane?: string, attemptMs?: number, maxAttempts?: number,
 *   label?: string | ((input: unknown) => string),
 *   run: (input: unknown, ctx: { signal: AbortSignal, report: (partial: object) => void }) => Promise<unknown> }>} opts.steps
 * @param {Record<string, { concurrency: number }>} [opts.lanes]
 * @param {(snapshot: object) => void} [opts.onChange] called on every job status/progress change
 * @param {() => number} [opts.now] injectable clock (tests)
 */
export function createJobRunner({ steps, lanes = {}, onChange, now = Date.now } = {}) {
  if (!steps) throw new Error("createJobRunner requires `steps`");

  /** runKey -> Map<dedupKey, Job> */
  const jobsByRun = new Map();
  /** laneName -> { running: Set<Job>, queue: Job[] } */
  const laneStates = new Map();

  function laneState(name) {
    let l = laneStates.get(name);
    if (!l) {
      l = { running: new Set(), queue: [] };
      laneStates.set(name, l);
    }
    return l;
  }

  function laneConcurrency(name) {
    return lanes[name]?.concurrency ?? 1;
  }

  function snapshot(job) {
    return {
      id: job.id,
      runKey: job.runKey,
      step: job.step,
      status: job.status,
      priority: job.priority,
      label: job.label,
      detail: job.detail,
      progress: job.progress,
      attempt: job.attempt,
      startedAt: job.startedAt,
      elapsedMs: job.startedAt != null ? now() - job.startedAt : undefined,
      error: job.error ? { message: job.error.message, code: job.error.code } : undefined,
    };
  }

  const listeners = new Set();
  if (onChange) listeners.add(onChange);

  /** Subscribe to every job snapshot change (queued/running/progress/terminal),
   *  across all runKeys. Returns an unsubscribe fn. Used by server/graph.mjs to
   *  drive RunSnapshot updates without this module knowing about runs/graphs. */
  function addListener(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function notify(job) {
    const snap = snapshot(job);
    for (const fn of listeners) fn(snap);
  }

  function getRunMap(runKey) {
    let m = jobsByRun.get(runKey);
    if (!m) {
      m = new Map();
      jobsByRun.set(runKey, m);
    }
    return m;
  }

  function reorderQueue(laneName) {
    laneState(laneName).queue.sort((a, b) => priorityRank(a) - priorityRank(b));
  }

  /**
   * Enqueue a step. Returns the job record synchronously — `job.settled` is
   * a promise resolving with the step's result (or rejecting with its
   * error). If an equivalent job is already live for this runKey, returns
   * the EXISTING job instead of starting a new execution; a blocking
   * request against an already-queued speculative job promotes it.
   */
  function enqueue(runKey, step, input, { priority = "blocking" } = {}) {
    const stepDef = steps[step];
    if (!stepDef) throw new Error(`Unknown job step: "${step}"`);
    const run = getRunMap(runKey);
    const key = dedupKey(step, input);
    const existing = run.get(key);
    if (existing && !TERMINAL_STATUSES.has(existing.status)) {
      if (priority === "blocking" && existing.priority === "speculative") {
        existing.priority = "blocking";
        reorderQueue(stepDef.lane ?? "default");
      }
      return existing;
    }

    const job = {
      id: crypto.randomUUID(),
      runKey,
      key,
      step,
      input,
      priority,
      status: "queued",
      label: typeof stepDef.label === "function" ? stepDef.label(input) : (stepDef.label ?? step),
      detail: undefined,
      progress: undefined,
      attempt: 0,
      maxAttempts: stepDef.maxAttempts ?? 1,
      controller: new AbortController(),
      superseded: false,
      startedAt: null,
      expiresAt: now() + JOB_TTL_MS,
      error: null,
    };
    job.settled = new Promise((resolve, reject) => {
      job._resolve = resolve;
      job._reject = reject;
    });
    // A rejection is always observed via job.settled by an interested caller,
    // but nothing requires anyone to await it (fire-and-forget speculation) —
    // don't let Node log an unhandled-rejection warning for that case.
    job.settled.catch(() => {});
    run.set(key, job);
    notify(job);

    const laneName = stepDef.lane ?? "default";
    laneState(laneName).queue.push(job);
    pump(laneName);
    return job;
  }

  function pump(laneName) {
    const l = laneState(laneName);
    reorderQueue(laneName);
    while (l.running.size < laneConcurrency(laneName)) {
      const next = l.queue.find((j) => j.status === "queued");
      if (!next) return;
      l.queue.splice(l.queue.indexOf(next), 1);
      l.running.add(next);
      void execute(next, laneName, l);
    }
  }

  async function execute(job, laneName, l) {
    const stepDef = steps[job.step];
    job.status = "running";
    job.startedAt = now();
    notify(job);

    const attemptMs = stepDef.attemptMs ?? 60_000;
    let lastErr = null;
    let lastAttemptTimedOut = false;

    for (job.attempt = 1; job.attempt <= job.maxAttempts; job.attempt++) {
      if (job.controller.signal.aborted) break;

      const attemptController = new AbortController();
      const onOuterAbort = () => attemptController.abort();
      job.controller.signal.addEventListener("abort", onOuterAbort);
      const timer = setTimeout(() => attemptController.abort(), attemptMs);

      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await stepDef.run(job.input, {
          signal: attemptController.signal,
          report: (partial) => {
            if (partial.detail !== undefined) job.detail = partial.detail;
            if (partial.progress !== undefined) job.progress = partial.progress;
            if (partial.label !== undefined) job.label = partial.label;
            notify(job);
          },
        });
        clearTimeout(timer);
        job.controller.signal.removeEventListener("abort", onOuterAbort);
        job.status = "done";
        notify(job);
        job._resolve(result);
        finish(job, laneName, l);
        return;
      } catch (err) {
        clearTimeout(timer);
        job.controller.signal.removeEventListener("abort", onOuterAbort);
        lastErr = err;
        const canceled = job.controller.signal.aborted;
        lastAttemptTimedOut = !canceled && attemptController.signal.aborted;
        if (canceled || lastAttemptTimedOut) break; // never retry a cancel or a timeout
        // else: the step threw for some other reason (validation-style
        // failure) — loop again for one retry, same as the pre-7b
        // orchestrator's "retry once on malformed reply" rule.
      }
    }

    if (job.controller.signal.aborted) {
      job.status = job.superseded ? "superseded" : "canceled";
      job.error = { message: lastErr?.message ?? "Canceled", code: job.status };
    } else {
      job.status = "failed";
      job.error = {
        message: lastErr?.message ?? "Job failed",
        code: lastAttemptTimedOut ? "timeout" : "failed",
      };
    }
    notify(job);
    job._reject(Object.assign(lastErr ?? new Error(job.error.message), { jobStatus: job.status }));
    finish(job, laneName, l);
  }

  function finish(job, laneName, l) {
    l.running.delete(job);
    pump(laneName);
  }

  /** Cancel one job. `supersede: true` marks it "superseded" instead of
   *  "canceled" (a newer job replaced it — same mechanism, different label
   *  for the UI/logs). No-op on an already-terminal job. */
  function cancel(job, { supersede = false } = {}) {
    if (!job || TERMINAL_STATUSES.has(job.status)) return;
    job.superseded = supersede;
    job.controller.abort();
  }

  /** Cancel every non-terminal job under a runKey. */
  function cancelRun(runKey) {
    const run = jobsByRun.get(runKey);
    if (!run) return;
    for (const job of run.values()) cancel(job);
  }

  /** Drop every (terminal) job under a runKey immediately — for callers with
   *  no natural TTL sweep (e.g. a one-shot request-scoped runKey). */
  function clearRun(runKey) {
    jobsByRun.delete(runKey);
  }

  /** Drop terminal jobs past their TTL. Call periodically for long-lived
   *  (session-scoped) runKeys; not needed for request-scoped ones using
   *  {@link clearRun}. */
  function sweep() {
    const t = now();
    for (const [runKey, run] of jobsByRun) {
      for (const [key, job] of run) {
        if (TERMINAL_STATUSES.has(job.status) && job.expiresAt <= t) run.delete(key);
      }
      if (run.size === 0) jobsByRun.delete(runKey);
    }
  }

  function getJobs(runKey) {
    const run = jobsByRun.get(runKey);
    return run ? [...run.values()].map(snapshot) : [];
  }

  return { enqueue, cancel, cancelRun, clearRun, sweep, getJobs, snapshot, addListener };
}
