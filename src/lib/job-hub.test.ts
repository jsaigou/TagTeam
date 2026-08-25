/**
 * Phase 7b — hub wiring for the background job runner + confirmTarget gate.
 * Extends the real-hub harness pattern in session-hub.test.ts (own copy —
 * that file doesn't export its helpers) with `runEngine`/`classifyIntent`
 * wired in, exercising server/hub.mjs + server/graph.mjs + server/jobs.mjs
 * together over a real WebSocket, not mocks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
// @ts-expect-error server .mjs modules ship without type declarations
import { attachHub, PAIRING_TTL_MS } from "../../server/hub.mjs";
// @ts-expect-error server .mjs modules ship without type declarations
import * as schema from "../../server/schema.mjs";
// @ts-expect-error server .mjs modules ship without type declarations
import { createJobRunner } from "../../server/jobs.mjs";
// @ts-expect-error server .mjs modules ship without type declarations
import { createRunEngine } from "../../server/graph.mjs";

function makeDb() {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = OFF");
  sqlite.exec(`
    CREATE TABLE "app_session" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "status" text NOT NULL DEFAULT 'active',
      "pairing_token" text,
      "pairing_expires_at" integer,
      "created_at" integer NOT NULL
    );
    CREATE INDEX "app_session_user_idx" ON "app_session" ("user_id");
  `);
  return drizzle(sqlite, { schema });
}

function activeSessionRow() {
  return {
    id: "session-1",
    userId: "user-1",
    status: "active",
    pairingToken: "K3M9QX",
    pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
    createdAt: new Date(),
  };
}

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** A controllable fake identifyTarget/geolocate/research/extractTargetRules
 *  step set — resolves synchronously to advance straight to the gate, so
 *  these tests exercise hub wiring, not real LLM/network latency. */
function fakeSteps() {
  const planScenarioInputs: unknown[] = [];
  return {
    planScenarioInputs,
    steps: {
      identifyTarget: {
        lane: "llm",
        run: async ({ goal }: { goal: string }) => ({ name: "Mejiro Dental Clinic", query: goal }),
      },
      parseDocument: {
        lane: "llm",
        run: async () => ({
          documentType: "letter",
          issuingAgency: "Ward office",
          purpose: "appointment",
          keyFields: [],
          questions: [],
        }),
      },
      geolocate: { run: async () => ({ locality: null, queryHint: null }) },
      research: {
        lane: "net",
        run: async () => ({
          query: "x",
          results: [
            { title: "Mejiro Dental Clinic", url: "https://a.example", snippet: "A" },
            { title: "Another Clinic", url: "https://b.example", snippet: "B" },
          ],
        }),
      },
      extractTargetRules: {
        lane: "llm",
        run: async ({ candidate }: { candidate: { name: string; url: string } }) => ({
          name: candidate.name,
          url: candidate.url,
          rules: [],
        }),
      },
      planScenario: {
        lane: "llm",
        run: async (input: unknown) => {
          planScenarioInputs.push(input);
          return { script: { scenarioTitle: "Fake scenario", turns: [] }, glossary: [] };
        },
      },
      // Sprint 1 (Switchboard Plan) — a soft dep of planScenario; must
      // resolve to SOME terminal status or planScenario never starts. A
      // neutral "no match" here since these tests exercise hub wiring, not
      // the classify-then-fill fast path (see server/plan-scenario.test.ts).
      classifyScenario: {
        lane: "llm",
        run: async () => ({ leafId: null }),
      },
    },
  };
}

async function startHub(rows: object[] = []) {
  const db = makeDb();
  for (const row of rows) {
    await db.insert(schema.appSession).values(row as never).run();
  }
  const { steps, planScenarioInputs } = fakeSteps();
  const jobRunner = createJobRunner({ steps });
  const runEngine = createRunEngine({ jobRunner });
  const classifyIntent = vi.fn(async (text: string, opts: { gateOpen?: boolean }) => {
    if (opts.gateOpen && /^yes/i.test(text)) return { intent: "confirm" };
    if (opts.gateOpen && /^no/i.test(text)) return { intent: "reject" };
    return { intent: "state_objective", objective: text };
  });

  const server = http.createServer();
  const hub = attachHub(server, { db, schema, runEngine, classifyIntent });
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { hub, runEngine, classifyIntent, planScenarioInputs, url: `ws://127.0.0.1:${port}/api/ws` };
}

type TestClient = { ws: WebSocket; received: unknown[]; opened: Promise<void> };

function connect(url: string, join: unknown): TestClient {
  const ws = new WebSocket(url);
  sockets.push(ws);
  const received: unknown[] = [];
  ws.on("message", (data: Buffer) => received.push(JSON.parse(data.toString())));
  const opened = new Promise<void>((resolve) => ws.on("open", () => resolve()));
  ws.on("open", () => ws.send(JSON.stringify(join)));
  return { ws, received, opened };
}

const joinStage = { type: "join", pairingToken: "K3M9QX", capabilities: ["stage", "input", "control"] };
const joinPhone = { type: "join", pairingToken: "K3M9QX", capabilities: ["input", "control"] };

type HubTestMessage = { type?: string } & Record<string, unknown>;

/** `after` (a `client.received.length` snapshot) restricts the search to
 *  messages that arrive from that point on — the run broadcasts several
 *  `run` snapshots as it progresses (gate absent, then gate present, then
 *  absent again post-confirm), so a bare "find the first match anywhere"
 *  would resolve instantly against a STALE earlier snapshot instead of
 *  actually waiting for the next one. */
function waitFor<T extends HubTestMessage = HubTestMessage>(
  client: TestClient,
  predicate: (m: T) => boolean,
  { ms = 2000, after = 0 }: { ms?: number; after?: number } = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + ms;
    const check = () => {
      const hit = client.received.slice(after).find(predicate as (m: unknown) => boolean) as
        | T
        | undefined;
      if (hit) return resolve(hit);
      if (Date.now() > deadline) return reject(new Error("timed out waiting for message"));
      setTimeout(check, 10);
    };
    check();
  });
}

describe("hub + run engine", () => {
  it("starting a run via `intent` streams a `run` broadcast with an open gate", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    await stage.opened;
    await waitFor(stage, (m) => m?.type === "joined");

    stage.ws.send(JSON.stringify({ type: "intent", text: "book an appointment at Mejiro Dental Clinic" }));

    const run = await waitFor(stage, (m) => m?.type === "run" && Boolean((m.run as { gate?: unknown })?.gate));
    const gate = (run.run as { gate: { candidates: Array<{ id: string }> }; runId: string }).gate;
    expect(gate.candidates).toHaveLength(2);
    expect(gate.candidates[0].id).toBe("https://a.example");
  });

  it("a device that joins mid-run gets the full RunSnapshot on join", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    await stage.opened;
    await waitFor(stage, (m) => m?.type === "joined");
    stage.ws.send(JSON.stringify({ type: "intent", text: "book an appointment at Mejiro Dental Clinic" }));
    await waitFor(stage, (m) => m?.type === "run" && Boolean((m.run as { gate?: unknown })?.gate));

    const phone = connect(url, joinPhone);
    await phone.opened;
    const joined = await waitFor(phone, (m) => m?.type === "joined");
    // The dedicated `run` message on join (not squeezed into `joined.snapshot`,
    // which is the pre-7b AppSnapshot channel and untouched by this feature).
    expect(joined.snapshot).toBeNull();
    const run = await waitFor(phone, (m) => m?.type === "run");
    expect((run.run as { gate?: { candidates: unknown[] } }).gate?.candidates).toHaveLength(2);
  });

  it("`confirm` from a companion resolves the gate and the phase clears it", async () => {
    const { url } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    const phone = connect(url, joinPhone);
    await Promise.all([stage.opened, phone.opened]);
    await waitFor(stage, (m) => m?.type === "joined");
    await waitFor(phone, (m) => m?.type === "joined");

    stage.ws.send(JSON.stringify({ type: "intent", text: "book an appointment at Mejiro Dental Clinic" }));
    const opened = await waitFor(stage, (m) => m?.type === "run" && Boolean((m.run as { gate?: unknown })?.gate));
    const { runId, gate } = opened.run as { runId: string; gate: { guessId: string } };

    const beforeConfirm = phone.received.length;
    phone.ws.send(JSON.stringify({ type: "confirm", runId, candidateId: gate.guessId }));

    const resolved = await waitFor(
      phone,
      (m) => m?.type === "run" && !(m.run as { gate?: unknown }).gate,
      { after: beforeConfirm },
    );
    const jobs = (resolved.run as { jobs: Array<{ step: string; status: string }> }).jobs;
    expect(jobs.find((j) => j.step === "confirmTarget")?.status).toBe("done");
  });

  it("a free-text \"yes\" confirms the open gate via classifyIntent's fast path", async () => {
    const { url, classifyIntent } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    await stage.opened;
    await waitFor(stage, (m) => m?.type === "joined");

    stage.ws.send(JSON.stringify({ type: "intent", text: "book an appointment at Mejiro Dental Clinic" }));
    await waitFor(stage, (m) => m?.type === "run" && Boolean((m.run as { gate?: unknown })?.gate));

    const beforeYes = stage.received.length;
    stage.ws.send(JSON.stringify({ type: "intent", text: "yes that's right" }));
    await waitFor(stage, (m) => m?.type === "run" && !(m.run as { gate?: unknown }).gate, {
      after: beforeYes,
    });

    expect(classifyIntent).toHaveBeenCalledWith("yes that's right", { gateOpen: true });
  });

  it("`cancelRun` stops a run in progress", async () => {
    const { url, runEngine } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    await stage.opened;
    await waitFor(stage, (m) => m?.type === "joined");

    stage.ws.send(JSON.stringify({ type: "intent", text: "book an appointment at Mejiro Dental Clinic" }));
    const opened = await waitFor(stage, (m) => m?.type === "run" && Boolean((m.run as { gate?: unknown })?.gate));
    const { runId } = opened.run as { runId: string };

    stage.ws.send(JSON.stringify({ type: "cancelRun", runId }));
    // cancelRun() is synchronous in graph.mjs — give the message a tick.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runEngine.getRun("session-1")).toBeNull();
  });

  it("`intent` with a context seeds the run and delivers the scenario result", async () => {
    const { url, planScenarioInputs } = await startHub([activeSessionRow()]);
    const stage = connect(url, joinStage);
    await stage.opened;
    await waitFor(stage, (m) => m?.type === "joined");

    stage.ws.send(
      JSON.stringify({
        type: "intent",
        text: "book an appointment at Mejiro Dental Clinic",
        context: {
          doc: { kind: "text", text: "I got a letter about a dental checkup" },
          answers: [{ questionId: "q1", answer: "next week" }],
          settings: { role: "reception", difficulty: "beginner", pace: "normal" },
        },
      }),
    );

    // The seeded doc enabled the parseDocument node alongside identifyTarget.
    const run = await waitFor(stage, (m) => m?.type === "run" && Boolean((m.run as { gate?: unknown })?.gate));
    const jobsAtGate = (run.run as { jobs: Array<{ step: string }> }).jobs;
    expect(jobsAtGate.some((j) => j.step === "parseDocument")).toBe(true);

    const { runId, gate } = run.run as { runId: string; gate: { guessId: string } };
    stage.ws.send(JSON.stringify({ type: "confirm", runId, candidateId: gate.guessId }));

    const done = await waitFor(stage, (m) => m?.type === "run" && Boolean((m.run as { result?: unknown })?.result));
    const result = (done.run as {
      result: { step: string; script: { scenarioTitle: string }; target?: { name: string; rules: unknown[] } };
    }).result;
    expect(result.step).toBe("planScenario");
    expect(result.script.scenarioTitle).toBe("Fake scenario");
    expect(result.target?.name).toBe("Mejiro Dental Clinic");

    // The seeded context reached planScenario's input — parseDocument's output
    // as docSummary (it completed), plus the client's answers/settings.
    expect(planScenarioInputs).toHaveLength(1);
    expect(planScenarioInputs[0]).toMatchObject({
      docSummary: { documentType: "letter" },
      answers: [{ questionId: "q1", answer: "next week" }],
      settings: { role: "reception", difficulty: "beginner", pace: "normal" },
    });
  });
});
