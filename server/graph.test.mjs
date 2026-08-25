/**
 * Engine-level regression for the mejirodai fixes: a user-pasted URL must
 * flow through readUrl → identifyTarget (page-grounded) → research (direct
 * page tagged user-url) → confirmTarget AUTO-CONFIRMED (the user's own link
 * is not a guess), while a text-only goal keeps the normal ask-the-user
 * gate. Also covers refineGoal (snapshot shows the inferred errand, not a
 * raw link) and the settleGate refactor of resolveGate's confirm path.
 */
import { describe, expect, it } from "vitest";
import { createRunEngine } from "./graph.mjs";
import { run as geolocateRun } from "./steps/geolocate.mjs";

const PAGE_URL = "https://clinic.example/";
const OBJECTIVE = "目白台歯科医院の予約時間を変更したい";

/** Minimal jobRunner stand-in: steps resolve on the next microtask; terminal
 *  failures are broadcast through the same addListener channel the engine
 *  subscribes to (that's how failed soft-deps trigger tryAdvance). */
function fakeJobRunner(steps, calls) {
  const listeners = new Set();
  const emit = (snap) => {
    for (const fn of listeners) fn(snap);
  };
  let nextId = 1;
  return {
    enqueue(_runKey, stepName, input, opts = {}) {
      const job = {
        id: `job-${nextId++}`,
        step: stepName,
        input,
        status: "running",
        priority: opts.priority ?? "blocking",
      };
      let resolve;
      let reject;
      job.settled = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
      });
      (calls[stepName] ??= []).push(input);
      queueMicrotask(async () => {
        try {
          const out = await steps[stepName](input);
          job.status = "done";
          resolve(out);
        } catch (err) {
          job.status = "failed";
          emit({ id: job.id, status: "failed", label: "", error: { message: err.message } });
          reject(err);
        }
      });
      return job;
    },
    cancel(job) {
      job.canceled = true;
    },
    cancelRun() {},
    addListener(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

async function waitFor(pred, ms = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timed out waiting for run state");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function harness(steps) {
  const calls = {};
  let latest = null;
  const engine = createRunEngine({
    jobRunner: fakeJobRunner(
      new Proxy(steps, {
        get(target, prop) {
          const fn = target[prop];
          if (!fn) throw new Error(`fakeJobRunner: no step "${String(prop)}"`);
          return fn;
        },
      }),
      calls,
    ),
  });
  engine.addListener((_runKey, snap) => {
    latest = snap;
  });
  return { engine, calls, snap: () => latest };
}

const IDENTIFIED = {
  name: "目白台歯科医院",
  city: "文京区",
  query: "目白台歯科医院 文京区 予約",
  alias: "mejirodaidental",
  objective: OBJECTIVE,
  objectiveEn: "Reschedule an appointment at Mejirodai Dental Clinic.",
};

describe("runEngine — pasted-URL goals", () => {
  it("auto-confirms the scraped user page end-to-end and refines the goal", async () => {
    const { engine, calls, snap } = harness({
      scrape: async ({ url }) => ({ url, markdown: "# 目白台歯科医院\n診療案内。" }),
      identifyTarget: async () => IDENTIFIED,
      geolocate: geolocateRun,
      research: async () => ({
        query: "",
        results: [
          { title: "目白台歯科医院", url: PAGE_URL, snippet: "公式", via: "user-url" },
          { title: "EPARK 歯科予約", url: "https://epark.example/d", snippet: "", via: "search" },
        ],
      }),
      extractTargetRules: async () => ({ rules: [{ rule: "予約は前日まで" }] }),
      planScenario: async () => ({ script: [], glossary: [] }),
      cheatSheet: async () => ({ cheatSheet: { items: [] } }),
    });

    engine.startRun("s1", PAGE_URL);
    await waitFor(() => snap()?.result?.cheatSheet);

    // The gate NEVER opened — the user's own page was committed as fact.
    expect(snap().gate).toBeUndefined();
    expect(snap().jobs.find((j) => j.id === "confirmTarget")?.status).toBe("done");
    // Downstream ran against the confirmed user URL at blocking priority.
    expect(calls.extractTargetRules[0]).toMatchObject({
      candidate: { id: PAGE_URL, via: "user-url" },
    });
    // planScenario scripts the INFERRED errand, not the raw link…
    expect(calls.planScenario[0].goal).toBe(OBJECTIVE);
    // …and the snapshot carries the refined goal too.
    expect(snap().goal).toBe(OBJECTIVE);
    // geolocate composed its hint from the crafted JP query.
    expect(calls.research[0].q).toContain("目白台歯科医院 文京区 予約");
  });

  it("degrades to the normal gate when the goal has no link", async () => {
    const { engine, snap } = harness({
      identifyTarget: async () => IDENTIFIED,
      geolocate: geolocateRun,
      research: async () => ({
        query: "",
        results: [
          { title: "目白台歯科（公式）", url: "https://a.example/", snippet: "", via: "search" },
          { title: "おすすめ歯医者ランキング", url: "https://lists.example/", snippet: "", via: "search" },
        ],
      }),
      // Runs speculatively against the gate's guess while it's open.
      extractTargetRules: async () => ({ rules: [] }),
    });

    engine.startRun("s2", "目白台の歯医者に電話して予約を変えたい");
    await waitFor(() => snap()?.gate);

    expect(snap().gate.guessId).toBe("https://a.example/");
    expect(snap().jobs.find((j) => j.id === "confirmTarget")?.status).toBe("needs_input");
  });

  it("resolveGate still settles an open gate (settleGate refactor)", async () => {
    const { engine, calls, snap } = harness({
      identifyTarget: async () => IDENTIFIED,
      geolocate: geolocateRun,
      research: async () => ({
        query: "",
        results: [
          { title: "目白台歯科（公式）", url: "https://a.example/", snippet: "", via: "search" },
        ],
      }),
      extractTargetRules: async ({ candidate }) => ({ ...candidate, rules: [] }),
      planScenario: async () => ({ script: [], glossary: [] }),
      cheatSheet: async () => ({ cheatSheet: { items: [] } }),
    });

    engine.startRun("s3", "目白台の歯医者に電話したい");
    await waitFor(() => snap()?.gate);
    const runId = snap().runId;
    expect(engine.resolveGate("s3", runId, snap().gate.guessId)).toBe(true);

    await waitFor(() => snap()?.result?.cheatSheet != null);
    expect(snap().gate).toBeUndefined();
    expect(snap().jobs.find((j) => j.id === "confirmTarget")?.status).toBe("done");
    expect(calls.extractTargetRules.at(-1).candidate.url).toBe("https://a.example/");
  });

  it("a failed readUrl scrape degrades softly instead of killing the run", async () => {
    const { engine, calls, snap } = harness({
      scrape: async () => {
        throw Object.assign(new Error("scrape down"), { status: 502 });
      },
      identifyTarget: async ({ page }) => {
        if (page) throw new Error("should not see a page after failed scrape");
        return IDENTIFIED;
      },
      geolocate: geolocateRun,
      research: async () => ({
        query: "",
        results: [
          { title: "目白台歯科（公式）", url: "https://a.example/", snippet: "", via: "search" },
        ],
      }),
      extractTargetRules: async () => ({ rules: [] }),
    });

    engine.startRun("s4", `${PAGE_URL} の歯医者に電話したい`);
    await waitFor(() => snap()?.gate);

    // No user-url candidate existed (scrape failed) → gate asks the user.
    expect(snap().gate.guessId).toBe("https://a.example/");
    // identifyTarget still ran, WITHOUT page content (soft dep accepted the
    // failure), so no prescraped page reached research.
    expect(calls.identifyTarget[0].page).toBeNull();
    expect(calls.research[0].prescraped).toBeUndefined();
  });
});
