import { describe, expect, it, vi } from "vitest";
// @ts-expect-error server .mjs modules ship without type declarations
import { classifyIntent, isIntentResult } from "../../server/intent.mjs";

describe("isIntentResult", () => {
  it("accepts a well-formed result", () => {
    expect(isIntentResult({ intent: "state_objective", objective: "book a clinic visit" })).toBe(true);
  });
  it("rejects an unknown intent", () => {
    expect(isIntentResult({ intent: "do_anything" })).toBe(false);
  });
  it("rejects non-string extra fields", () => {
    expect(isIntentResult({ intent: "confirm", targetName: 5 })).toBe(false);
  });
});

describe("classifyIntent", () => {
  it("fast-paths a bare URL with no LLM call", async () => {
    const llmChat = vi.fn();
    const result = await classifyIntent("https://city.example/clinic", { llmChat });
    expect(result).toEqual({ intent: "provide_url", url: "https://city.example/clinic" });
    expect(llmChat).not.toHaveBeenCalled();
  });

  it("only fast-paths yes/no when a gate is open", async () => {
    const llmChat = vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({ intent: "other" }) } }],
    }));
    const result = await classifyIntent("yes that's right", { llmChat, gateOpen: false });
    expect(result).toEqual({ intent: "other" });
    expect(llmChat).toHaveBeenCalledOnce();
  });

  it("fast-paths confirm/reject when a gate is open, no LLM call", async () => {
    const llmChat = vi.fn();
    expect(await classifyIntent("Yes, that's right", { llmChat, gateOpen: true })).toEqual({
      intent: "confirm",
    });
    expect(await classifyIntent("no, none of those", { llmChat, gateOpen: true })).toEqual({
      intent: "reject",
    });
    expect(llmChat).not.toHaveBeenCalled();
  });

  it("falls back to a schema-validated LLM call for free text", async () => {
    const llmChat = vi.fn(async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({ intent: "state_objective", objective: "renew my visa" }),
          },
        },
      ],
    }));
    const result = await classifyIntent("I need to renew my visa", { llmChat });
    expect(result).toEqual({ intent: "state_objective", objective: "renew my visa" });
  });

  it("degrades to \"other\" on malformed LLM JSON instead of throwing", async () => {
    const llmChat = vi.fn(async () => ({ choices: [{ message: { content: "not json" } }] }));
    const result = await classifyIntent("something ambiguous", { llmChat });
    expect(result).toEqual({ intent: "other" });
  });

  it("degrades to \"other\" when the LLM result fails schema validation", async () => {
    const llmChat = vi.fn(async () => ({
      choices: [{ message: { content: JSON.stringify({ intent: "made_up" }) } }],
    }));
    const result = await classifyIntent("something ambiguous", { llmChat });
    expect(result).toEqual({ intent: "other" });
  });

  it("returns \"other\" for empty text without calling the LLM", async () => {
    const llmChat = vi.fn();
    expect(await classifyIntent("   ", { llmChat })).toEqual({ intent: "other" });
    expect(llmChat).not.toHaveBeenCalled();
  });
});
