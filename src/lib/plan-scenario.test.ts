/**
 * `server/steps/planScenario.mjs` — the Phase 7b server-side migration of
 * `generateSimulation` (Phase 7 plan §7b.5 migration step 4). `llmChat` is
 * mocked (same style as `sim-engine.test.ts`'s stubbed fetch); the ported
 * validation/reconciliation itself is covered by `server-glossary.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOC_SUMMARY_FIXTURE, SIM_JSON } from "../fixtures/llm";

const llmChat = vi.fn();
vi.mock("../../server/providers.mjs", () => ({ llmChat: (...args: unknown[]) => llmChat(...args) }));

// @ts-expect-error server .mjs modules ship without type declarations
const { run, buildReferenceDigest } = await import("../../server/steps/planScenario.mjs");

function chatResult(content: string) {
  return { choices: [{ message: { content } }] };
}

const ANSWERS = [{ questionId: "q1", answer: "I want to claim a medical expense tax deduction" }];
const report = vi.fn();
const ctx = { signal: new AbortController().signal, report };

beforeEach(() => {
  llmChat.mockReset();
  report.mockReset();
});

describe("planScenario run()", () => {
  it("synthesizes a docSummary for document-less (URL-only) runs and calls the LLM", async () => {
    llmChat.mockResolvedValue(chatResult(SIM_JSON));
    const result = await run(
      { answers: ANSWERS, goal: "https://ward.example/nenkin", target: { name: "Ward Office" } },
      ctx,
    );
    expect(result.script.turns[0].speaker).toBe("bureaucrat");
    const [messages] = llmChat.mock.calls[0];
    const userMsg = messages.find((m: { role: string }) => m.role === "user").content;
    expect(userMsg).toContain("なし"); // synthesized documentType
    expect(userMsg).toContain("Ward Office"); // agency from confirmed target
  });

  it("builds a script + glossary from a valid LLM reply", async () => {
    llmChat.mockResolvedValue(chatResult(SIM_JSON));
    const result = await run({ docSummary: DOC_SUMMARY_FIXTURE, answers: ANSWERS }, ctx);
    expect(result.script.scenarioTitle).toBeTruthy();
    expect(result.script.turns[0].speaker).toBe("bureaucrat");
    expect(result.glossary.length).toBeGreaterThan(0);
    expect(report).toHaveBeenCalled();
  });

  it("passes coaching guidance and the confirmed target as reference into the prompt", async () => {
    llmChat.mockResolvedValue(chatResult(SIM_JSON));
    await run(
      {
        docSummary: DOC_SUMMARY_FIXTURE,
        answers: ANSWERS,
        settings: { role: "reception", difficulty: "beginner", pace: "slow" },
        target: {
          name: "Mejiro Dental Clinic",
          url: "https://a.example",
          address: "Toshima, Tokyo",
          rules: [{ id: "r1", rule: "Open 9-17 weekdays", kind: "hours", source: "https://a.example" }],
        },
      },
      ctx,
    );
    const [messages] = llmChat.mock.calls[0];
    const userMsg = messages.find((m: { role: string }) => m.role === "user").content;
    expect(userMsg).toContain("Mejiro Dental Clinic");
    expect(userMsg).toContain("Open 9-17 weekdays");
  });

  it("tolerates a fenced JSON code block", async () => {
    llmChat.mockResolvedValue(chatResult(`\`\`\`json\n${SIM_JSON}\n\`\`\``));
    const result = await run({ docSummary: DOC_SUMMARY_FIXTURE, answers: ANSWERS }, ctx);
    expect(result.script.turns.length).toBeGreaterThanOrEqual(6);
  });

  it("rejects invalid JSON with a 502", async () => {
    llmChat.mockResolvedValue(chatResult("not json"));
    await expect(run({ docSummary: DOC_SUMMARY_FIXTURE, answers: ANSWERS }, ctx)).rejects.toMatchObject({
      status: 502,
    });
  });

  it("rejects a reply that fails schema validation with a 502", async () => {
    llmChat.mockResolvedValue(chatResult(JSON.stringify({ scenarioTitle: "x" })));
    await expect(run({ docSummary: DOC_SUMMARY_FIXTURE, answers: ANSWERS }, ctx)).rejects.toMatchObject({
      status: 502,
    });
  });
});

// Exercised directly because server/routes/sessions.mjs's call-context route
// now reuses this exact function to rebuild the live call's reference from
// the confirmed target — see that route's `groundedReference` line — instead
// of trusting a separately-sourced `reference` string that could drift from
// what the script was actually written from.
describe("buildReferenceDigest", () => {
  it("renders the confirmed office name, address, url and cited rules", () => {
    const digest = buildReferenceDigest({
      name: "Mejiro Dental Clinic",
      url: "https://a.example",
      address: "Toshima, Tokyo",
      rules: [{ id: "r1", rule: "Closed Sundays", kind: "hours", source: "https://a.example" }],
    });
    expect(digest).toContain("Mejiro Dental Clinic");
    expect(digest).toContain("Toshima, Tokyo");
    expect(digest).toContain("https://a.example");
    expect(digest).toContain("Closed Sundays");
  });

  it("omits the rules section when there are none", () => {
    const digest = buildReferenceDigest({ name: "Mejiro Dental Clinic", rules: [] });
    expect(digest).toContain("Mejiro Dental Clinic");
    expect(digest).not.toContain("窓口ルール");
  });

  it("returns undefined for a missing or nameless target — the route's fallback to `reference` then applies", () => {
    expect(buildReferenceDigest(undefined)).toBeUndefined();
    expect(buildReferenceDigest(null)).toBeUndefined();
    expect(buildReferenceDigest({ rules: [] })).toBeUndefined();
  });
});
