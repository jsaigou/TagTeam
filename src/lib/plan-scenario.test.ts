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
const { run } = await import("../../server/steps/planScenario.mjs");

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
  it("rejects a missing docSummary before calling the LLM", async () => {
    await expect(run({ answers: ANSWERS }, ctx)).rejects.toThrow(/Document summary is missing/);
    expect(llmChat).not.toHaveBeenCalled();
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
