/**
 * classifyScenario (Sprint 0 step, Switchboard Plan): schema-validated LLM
 * classification of a free-text objective into the scenario taxonomy
 * (server/scenario-taxonomy.mjs), or null when nothing matches. Same
 * explicit-null tolerance and fast-path discipline as identifyTarget.mjs /
 * intent.mjs — see those tests for the trap this guards against.
 */
import { describe, expect, it, vi } from "vitest";
import { createClassifyScenarioStep, isClassifyScenarioResult } from "./steps/classifyScenario.mjs";
import { LEAF_IDS } from "./scenario-taxonomy.mjs";

function chatReturning(content) {
  return async () => ({ choices: [{ message: { role: "assistant", content } }] });
}

describe("isClassifyScenarioResult", () => {
  it("accepts a real leaf id and null confidence", () => {
    expect(isClassifyScenarioResult({ leafId: "appt.doctor_dentist", confidence: null })).toBe(true);
  });

  it("accepts an explicit null leafId — the whole point of the field", () => {
    expect(isClassifyScenarioResult({ leafId: null })).toBe(true);
  });

  it("rejects an id that isn't in the taxonomy, or a non-numeric confidence", () => {
    expect(isClassifyScenarioResult({ leafId: "not.a.real.leaf" })).toBe(false);
    expect(isClassifyScenarioResult({ leafId: "appt.doctor_dentist", confidence: "high" })).toBe(false);
    expect(isClassifyScenarioResult(null)).toBe(false);
  });
});

describe("createClassifyScenarioStep", () => {
  it("classifies a clear objective into the matching leaf", async () => {
    const llmChat = vi.fn(chatReturning(JSON.stringify({ leafId: "appt.doctor_dentist", confidence: 0.9 })));
    const run = createClassifyScenarioStep({ llmChat });
    const out = await run({ goal: "I need to book a dentist appointment" }, {});
    expect(out).toEqual({ leafId: "appt.doctor_dentist", confidence: 0.9 });
  });

  it("passes every taxonomy leaf id through to the model in the system prompt", async () => {
    let seenSystem = "";
    const run = createClassifyScenarioStep({
      llmChat: async (messages) => {
        seenSystem = messages.find((m) => m.role === "system").content;
        return { choices: [{ message: { content: JSON.stringify({ leafId: null }) } }] };
      },
    });
    await run({ goal: "some long enough objective text" }, {});
    for (const id of LEAF_IDS) expect(seenSystem).toContain(id);
  });

  it("returns leafId: null without calling the model when the goal is too short", async () => {
    const llmChat = vi.fn();
    const run = createClassifyScenarioStep({ llmChat });
    expect(await run({ goal: "hi" }, {})).toEqual({ leafId: null });
    expect(await run({ goal: "" }, {})).toEqual({ leafId: null });
    expect(llmChat).not.toHaveBeenCalled();
  });

  it("falls back to leafId: null on malformed JSON or a schema-invalid reply — never throws", async () => {
    const malformed = createClassifyScenarioStep({ llmChat: chatReturning("not json") });
    await expect(malformed({ goal: "something the model garbles" }, {})).resolves.toEqual({ leafId: null });

    const badId = createClassifyScenarioStep({
      llmChat: chatReturning(JSON.stringify({ leafId: "nonexistent.leaf" })),
    });
    await expect(badId({ goal: "something ambiguous" }, {})).resolves.toEqual({ leafId: null });
  });

  it("does not clearly force-match an out-of-taxonomy request — the model saying null is honored", async () => {
    const run = createClassifyScenarioStep({
      llmChat: chatReturning(JSON.stringify({ leafId: null, confidence: 0.1 })),
    });
    const out = await run({ goal: "I need help with my visa renewal" }, {});
    expect(out.leafId).toBeNull();
  });
});
