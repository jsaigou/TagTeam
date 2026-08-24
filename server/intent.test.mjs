/**
 * Regression: models emit explicit `null` for optional fields
 * (`"city": null`). The strict `!== undefined` validators rejected such
 * payloads wholesale, so every objective classified as "other" and NO
 * background work ever started (product-flow bug, 2026-08-25).
 */
import { describe, expect, it } from "vitest";
import { classifyIntent, isIntentResult } from "./intent.mjs";

describe("isIntentResult", () => {
  it("accepts a state_objective with explicit-null optionals", () => {
    expect(
      isIntentResult({
        intent: "state_objective",
        targetName: "Mejirodai Dental Clinic",
        city: null,
        url: null,
        objective: "book an appointment with my dentist",
        confidence: 1.0,
      }),
    ).toBe(true);
  });

  it("still rejects wrong-typed fields", () => {
    expect(isIntentResult({ intent: "state_objective", targetName: 42 })).toBe(false);
    expect(isIntentResult({ intent: "nope" })).toBe(false);
  });
});

describe("classifyIntent", () => {
  const llmChat = async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            intent: "state_objective",
            targetName: "Mejirodai Dental Clinic",
            city: null,
            objective: "book an appointment",
            confidence: null,
          }),
        },
      },
    ],
  });

  it("classifies a clear objective even when the model emits nulls", async () => {
    const out = await classifyIntent(
      "I want to book an appointment with my dentist. Mejirodai Dental Clinic",
      { llmChat },
    );
    expect(out.intent).toBe("state_objective");
    expect(out.targetName).toBe("Mejirodai Dental Clinic");
    // Nulls are dropped, not passed through.
    expect("city" in out).toBe(false);
    expect("confidence" in out).toBe(false);
  });

  it("falls back to other on unparseable content", async () => {
    const out = await classifyIntent("hello", {
      llmChat: async () => ({ choices: [{ message: { content: "not json" } }] }),
    });
    expect(out).toEqual({ intent: "other" });
  });

  it("fast-paths bare yes/no when a candidate confirmation is pending", async () => {
    let calls = 0;
    const spy = async () => {
      calls += 1;
      return { choices: [{ message: { content: "{}" } }] };
    };
    const yes = await classifyIntent("yes", { gateOpen: true, llmChat: spy });
    const no = await classifyIntent("nope", { gateOpen: true, llmChat: spy });
    expect(yes.intent).toBe("confirm");
    expect(no.intent).toBe("reject");
    expect(calls).toBe(0);
  });
});
