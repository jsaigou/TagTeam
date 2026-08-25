/**
 * identifyTarget (Phase 7b step): schema-validated LLM classification of the
 * call target. Covers the mejirodai fixes — Japanese-script name
 * normalization with a romanized alias, page-grounded inference
 * (objective/objectiveEn from readUrl's scrape) — and the validator's
 * tolerance for explicit-null optionals (the trap that once silently failed
 * every classification; see intent.mjs).
 */
import { describe, expect, it } from "vitest";
import { createIdentifyTargetStep, isIdentifyTargetResult } from "./steps/identifyTarget.mjs";

/** Fake llmChat returning a canned OpenAI-shaped reply. */
function chatReturning(content) {
  return async () => ({ choices: [{ message: { role: "assistant", content } }] });
}

const GOOD_JSON = JSON.stringify({
  name: "目白台歯科医院",
  alias: "mejirodai dental / mejirodaidental",
  city: "文京区",
  query: "目白台歯科医院 文京区 予約",
  objective: "虫歯の治療予約を取りたい",
  objectiveEn: "Book a cavity treatment appointment at Mejirodai Dental Clinic.",
});

describe("isIdentifyTargetResult", () => {
  it("accepts required name/query and null optionals", () => {
    expect(isIdentifyTargetResult({ name: "x", query: "y", city: null, alias: null })).toBe(true);
  });

  it("rejects empty name, missing query, or non-string optionals", () => {
    expect(isIdentifyTargetResult({ name: " ", query: "y" })).toBe(false);
    expect(isIdentifyTargetResult({ name: "x" })).toBe(false);
    expect(isIdentifyTargetResult({ name: "x", query: "y", alias: 7 })).toBe(false);
    expect(isIdentifyTargetResult(null)).toBe(false);
  });
});

describe("createIdentifyTargetStep", () => {
  it("maps the full result including alias/objective/objectiveEn", async () => {
    const run = createIdentifyTargetStep({ llmChat: chatReturning(GOOD_JSON) });
    const out = await run({ goal: "call the dentist in mejirodai" }, {});
    expect(out).toEqual({
      name: "目白台歯科医院",
      alias: "mejirodai dental / mejirodaidental",
      city: "文京区",
      query: "目白台歯科医院 文京区 予約",
      objective: "虫歯の治療予約を取りたい",
      objectiveEn: "Book a cavity treatment appointment at Mejirodai Dental Clinic.",
    });
  });

  it("feeds scraped page markdown to the model when provided", async () => {
    let seen = "";
    const run = createIdentifyTargetStep({
      llmChat: async (messages) => {
        seen = messages.find((m) => m.role === "user").content;
        return { choices: [{ message: { content: GOOD_JSON } }] };
      },
    });
    await run(
      {
        goal: "https://mejirodaidental.example/",
        page: { url: "https://mejirodaidental.example/", markdown: "# 目白台歯科医院\n診療時間…" },
      },
      {},
    );
    expect(seen).toContain("page (https://mejirodaidental.example/)");
    expect(seen).toContain("目白台歯科医院");
  });

  it("runs on page content alone (bare-URL goal)", async () => {
    const run = createIdentifyTargetStep({ llmChat: chatReturning(GOOD_JSON) });
    await expect(run({ goal: "", page: { url: "https://x.test/", markdown: "# clinic" } }, {})).resolves.toMatchObject({
      name: "目白台歯科医院",
    });
  });

  it("rejects an empty goal with no page", async () => {
    const run = createIdentifyTargetStep({ llmChat: chatReturning(GOOD_JSON) });
    await expect(run({ goal: "   " }, {})).rejects.toMatchObject({ status: 400 });
  });

  it("throws 502 on malformed or schema-invalid model output", async () => {
    const badJson = createIdentifyTargetStep({ llmChat: chatReturning("not json") });
    await expect(badJson({ goal: "dentist" }, {})).rejects.toMatchObject({ status: 502 });
    const wrongSchema = createIdentifyTargetStep({
      llmChat: chatReturning(JSON.stringify({ name: "", query: "" })),
    });
    await expect(wrongSchema({ goal: "dentist" }, {})).rejects.toMatchObject({ status: 502 });
  });
});
