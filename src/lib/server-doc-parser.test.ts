/**
 * Parity tests for `server/doc-parser.mjs`, the Phase 7b port of
 * `src/lib/doc-parser.ts`'s `isDocSummary` + `src/lib/llm.ts`'s
 * `isGroundingQuestion`/`isGroundingQuestionArray` (Phase 7 plan §7b.5
 * migration step 5 — "port, don't re-derive"). Runs the SAME fixtures
 * `doc-parser.test.ts` uses (plus edge cases) through BOTH the client
 * original and the server port and asserts they agree on every input.
 */
import { describe, expect, it } from "vitest";
import { isDocSummary } from "./doc-parser";
import { isGroundingQuestionArray } from "./llm";
import { DOC_SUMMARY_FIXTURE, DOC_SUMMARY_JSON } from "../fixtures/llm";
// @ts-expect-error server .mjs modules ship without type declarations
import { isDocSummary as isDocSummaryServer, isGroundingQuestionArray as isGroundingQuestionArrayServer } from "../../server/doc-parser.mjs";

const VALID_SUMMARY = DOC_SUMMARY_FIXTURE;
const PARSED_SUMMARY = JSON.parse(DOC_SUMMARY_JSON);

const SUMMARY_CASES: Array<{ name: string; value: unknown }> = [
  { name: "the DOC_SUMMARY_FIXTURE", value: VALID_SUMMARY },
  { name: "the parsed DOC_SUMMARY_JSON the mock LLM returns", value: PARSED_SUMMARY },
  {
    name: "a minimal summary with no question options",
    value: {
      documentType: "通知",
      issuingAgency: "市役所",
      purpose: "A notice.",
      keyFields: ["a"],
      questions: [{ id: "q1", question: "Why are you calling?" }],
    },
  },
  {
    name: "a summary with empty keyFields and questions arrays",
    value: {
      documentType: "通知",
      issuingAgency: "市役所",
      purpose: "A notice.",
      keyFields: [],
      questions: [],
    },
  },
  {
    name: "a summary with extra unknown fields (validateShape ignores them)",
    value: { ...VALID_SUMMARY, extra: true },
  },
  { name: "the wrong-shape reply doc-parser.test.ts uses ({ documentType: 'x' })", value: { documentType: "x" } },
  { name: "a summary missing questions", value: { ...VALID_SUMMARY, questions: undefined } },
  { name: "a summary with null purpose", value: { ...VALID_SUMMARY, purpose: null } },
  { name: "a summary with an empty-string documentType", value: { ...VALID_SUMMARY, documentType: "   " } },
  { name: "a summary whose keyFields hold a non-string", value: { ...VALID_SUMMARY, keyFields: ["ok", 3] } },
  {
    name: "a summary whose question entry has no question text",
    value: { ...VALID_SUMMARY, questions: [{ id: "q1" }] },
  },
  {
    name: "a summary whose question options hold a non-string",
    value: { ...VALID_SUMMARY, questions: [{ id: "q1", question: "Q?", options: ["ok", 7] }] },
  },
  { name: "null", value: null },
  { name: "undefined", value: undefined },
  { name: "a string", value: "not an object" },
  { name: "an array", value: [VALID_SUMMARY] },
];

describe("server/doc-parser.mjs isDocSummary parity with src/lib/doc-parser.ts", () => {
  for (const { name, value } of SUMMARY_CASES) {
    it(`agrees with the client validator on ${name}`, () => {
      expect(isDocSummaryServer(value)).toBe(isDocSummary(value));
    });
  }

  it("accepts the fixture on both sides (sanity: the case list isn't all false)", () => {
    expect(isDocSummary(VALID_SUMMARY)).toBe(true);
    expect(isDocSummaryServer(VALID_SUMMARY)).toBe(true);
    expect(isDocSummaryServer(PARSED_SUMMARY)).toBe(true);
  });
});

const QUESTION_CASES: Array<{ name: string; value: unknown }> = [
  { name: "the fixture's questions (one with options, one without)", value: VALID_SUMMARY.questions },
  { name: "an empty array", value: [] },
  { name: "a question with empty options", value: [{ id: "q1", question: "Q?", options: [] }] },
  { name: "an entry missing id", value: [{ question: "Q?" }] },
  { name: "an entry with a blank question", value: [{ id: "q1", question: "" }] },
  { name: "a non-array", value: { id: "q1", question: "Q?" } },
];

describe("server/doc-parser.mjs isGroundingQuestionArray parity with src/lib/llm.ts", () => {
  for (const { name, value } of QUESTION_CASES) {
    it(`agrees with the client validator on ${name}`, () => {
      expect(isGroundingQuestionArrayServer(value)).toBe(isGroundingQuestionArray(value));
    });
  }
});
