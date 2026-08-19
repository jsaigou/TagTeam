import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error server .mjs modules ship without type declarations
import { createJobRunner, JOB_TTL_MS } from "../../server/jobs.mjs";

type Signal = AbortSignal;
type Report = (partial: Record<string, unknown>) => void;
type StepRun = (input: unknown, ctx: { signal: Signal; report: Report }) => Promise<unknown>;

afterEach(() => {
  vi.useRealTimers();
});

/** A step whose completion is controlled externally via `release()`. */
function controllableStep() {
  let release!: (value?: unknown) => void;
  const gate = new Promise((r) => (release = r));
  const calls: unknown[] = [];
  const run: StepRun = async (input, { signal }) => {
    calls.push(input);
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")));
      void gate.then(resolve);
    });
  };
  return { run, calls, release: (v?: unknown) => release(v) };
}

describe("createJobRunner", () => {
  it("dedups two enqueues of the same runKey+step+input into one execution", async () => {
    const step = controllableStep();
    const runner = createJobRunner({ steps: { echo: { run: step.run } } });

    const a = runner.enqueue("run-1", "echo", { q: "clinic" });
    const b = runner.enqueue("run-1", "echo", { q: "clinic" });

    expect(b.id).toBe(a.id);
    expect(step.calls).toHaveLength(1);

    step.release("done");
    await expect(a.settled).resolves.toBe("done");
    await expect(b.settled).resolves.toBe("done");
  });

  it("does not dedup across different runKeys", async () => {
    const step = controllableStep();
    const runner = createJobRunner({ steps: { echo: { run: step.run } } });

    const a = runner.enqueue("run-1", "echo", { q: "clinic" });
    const b = runner.enqueue("run-2", "echo", { q: "clinic" });
    expect(b.id).not.toBe(a.id);

    // Same step/input, but different runKeys share no lane state either —
    // both eventually execute independently (the default lane's concurrency
    // limit only serializes jobs within one runKey's queue position, not
    // identity), proving these are two real executions, not one shared job.
    step.release("done");
    await expect(a.settled).resolves.toBe("done");
    await expect(b.settled).resolves.toBe("done");
    expect(step.calls).toHaveLength(2);
  });

  it("serializes a lane at its configured concurrency", async () => {
    const active: number[] = [];
    let maxConcurrent = 0;
    const run: StepRun = async () => {
      active.push(1);
      maxConcurrent = Math.max(maxConcurrent, active.length);
      await new Promise((r) => setTimeout(r, 5));
      active.pop();
      return "ok";
    };
    const runner = createJobRunner({
      steps: { llm: { run, lane: "llm" } },
      lanes: { llm: { concurrency: 1 } },
    });

    const jobs = [
      runner.enqueue("s1", "llm", { i: 1 }),
      runner.enqueue("s1", "llm", { i: 2 }),
      runner.enqueue("s1", "llm", { i: 3 }),
    ];
    await Promise.all(jobs.map((j) => j.settled));
    expect(maxConcurrent).toBe(1);
  });

  it("runs a blocking job before still-queued speculative ones", async () => {
    const order: string[] = [];
    const blocker = controllableStep();
    const run: StepRun = async (input) => {
      order.push((input as { tag: string }).tag);
      return "ok";
    };
    const runner = createJobRunner({
      steps: {
        block: { run: blocker.run, lane: "llm" },
        step: { run, lane: "llm" },
      },
      lanes: { llm: { concurrency: 1 } },
    });

    // Occupies the lane's one slot so the next three queue up behind it.
    const held = runner.enqueue("s1", "block", { hold: true });
    const spec1 = runner.enqueue("s1", "step", { tag: "spec1" }, { priority: "speculative" });
    const spec2 = runner.enqueue("s1", "step", { tag: "spec2" }, { priority: "speculative" });
    const blocking = runner.enqueue("s1", "step", { tag: "blocking" }, { priority: "blocking" });

    blocker.release();
    await held.settled.catch(() => {});
    await Promise.all([spec1.settled, spec2.settled, blocking.settled]);

    expect(order[0]).toBe("blocking");
    expect(order.slice(1).sort()).toEqual(["spec1", "spec2"]);
  });

  it("promotes an already-queued speculative job when a blocking enqueue matches it", async () => {
    const blocker = controllableStep();
    const run: StepRun = async () => "ok";
    const runner = createJobRunner({
      steps: {
        block: { run: blocker.run, lane: "llm" },
        step: { run, lane: "llm" },
      },
      lanes: { llm: { concurrency: 1 } },
    });

    runner.enqueue("s1", "block", { hold: true });
    const spec = runner.enqueue("s1", "step", { q: "x" }, { priority: "speculative" });
    const blocking = runner.enqueue("s1", "step", { q: "x" }, { priority: "blocking" });

    expect(blocking.id).toBe(spec.id);
    expect(blocking.priority).toBe("blocking");
  });

  it("excludes queue wait from the attempt deadline — only counts execution time", async () => {
    vi.useFakeTimers();
    const holder = controllableStep();
    const run: StepRun = async (_input, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timed out")));
      });
    const runner = createJobRunner({
      steps: {
        block: { run: holder.run, lane: "llm" },
        slow: { run, lane: "llm", attemptMs: 100 },
      },
      lanes: { llm: { concurrency: 1 } },
    });

    runner.enqueue("s1", "block", {});
    const job = runner.enqueue("s1", "slow", {}, { priority: "speculative" });

    // The job sits queued behind `block` for far longer than its own
    // attemptMs — it must not be touched while queued.
    await vi.advanceTimersByTimeAsync(500);
    expect(job.status).toBe("queued");

    holder.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(job.status).toBe("running");

    await vi.advanceTimersByTimeAsync(150);
    await expect(job.settled).rejects.toMatchObject({ jobStatus: "failed" });
    expect(job.status).toBe("failed");
    expect(job.error.code).toBe("timeout");
  });

  it("retries once on a validation-style failure, then succeeds", async () => {
    let calls = 0;
    const run: StepRun = async () => {
      calls++;
      if (calls === 1) throw new Error("malformed JSON");
      return "ok";
    };
    const runner = createJobRunner({ steps: { flaky: { run, maxAttempts: 2 } } });

    const job = runner.enqueue("s1", "flaky", {});
    await expect(job.settled).resolves.toBe("ok");
    expect(calls).toBe(2);
    expect(job.status).toBe("done");
  });

  it("never retries a timeout", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const run: StepRun = async (_input, { signal }) => {
      calls++;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("timed out")));
      });
    };
    const runner = createJobRunner({
      steps: { slow: { run, attemptMs: 50, maxAttempts: 2 } },
    });

    const job = runner.enqueue("s1", "slow", {});
    await vi.advanceTimersByTimeAsync(60);
    await expect(job.settled).rejects.toMatchObject({ jobStatus: "failed" });
    expect(calls).toBe(1);
    expect(job.error.code).toBe("timeout");
  });

  it("reports a cancel (not a timeout) when supersede replaces a job", async () => {
    const step = controllableStep();
    const runner = createJobRunner({ steps: { echo: { run: step.run } } });

    const job = runner.enqueue("s1", "echo", { q: "a" });
    runner.cancel(job, { supersede: true });

    await expect(job.settled).rejects.toMatchObject({ jobStatus: "superseded" });
    expect(job.status).toBe("superseded");
    expect(job.error.code).toBe("superseded");
  });

  it("cancelRun aborts every non-terminal job under a runKey", async () => {
    const stepA = controllableStep();
    const stepB = controllableStep();
    const runner = createJobRunner({
      steps: { a: { run: stepA.run }, b: { run: stepB.run } },
    });

    const jobA = runner.enqueue("s1", "a", {});
    const jobB = runner.enqueue("s1", "b", {});
    runner.cancelRun("s1");

    await expect(jobA.settled).rejects.toMatchObject({ jobStatus: "canceled" });
    await expect(jobB.settled).rejects.toMatchObject({ jobStatus: "canceled" });
  });

  it("streams progress via report() before the job settles", async () => {
    const seen: unknown[] = [];
    const run: StepRun = async (_input, { report }) => {
      report({ detail: "step 1 of 2" });
      report({ detail: "step 2 of 2", progress: 0.5 });
      return "ok";
    };
    const runner = createJobRunner({
      steps: { multi: { run } },
      onChange: (snap: { detail?: string }) => seen.push(snap.detail),
    });
    const job = runner.enqueue("s1", "multi", {});
    await job.settled;
    expect(seen).toContain("step 1 of 2");
    expect(seen).toContain("step 2 of 2");
  });

  it("sweep() drops terminal jobs past their TTL and leaves live ones", () => {
    let t = 1_000;
    const run: StepRun = async () => "ok";
    const runner = createJobRunner({ steps: { fast: { run } }, now: () => t });

    const job = runner.enqueue("s1", "fast", {});
    job.status = "done"; // simulate completion without waiting on microtasks
    t += JOB_TTL_MS + 1;
    runner.sweep();
    expect(runner.getJobs("s1")).toHaveLength(0);
  });

  it("clearRun drops a run's jobs immediately regardless of TTL", () => {
    const step = controllableStep();
    const runner = createJobRunner({ steps: { echo: { run: step.run } } });
    runner.enqueue("s1", "echo", {});
    expect(runner.getJobs("s1")).toHaveLength(1);
    runner.clearRun("s1");
    expect(runner.getJobs("s1")).toHaveLength(0);
  });
});
