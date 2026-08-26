/**
 * DocSummary validation, ported from `src/lib/doc-parser.ts` (isDocSummary)
 * and `src/lib/llm.ts` (isGroundingQuestion/isGroundingQuestionArray) for the
 * server-side `parseDocument` job step (Phase 7 plan §7b.5 migration step 5).
 * Ported rather than re-derived — keep in sync with the client copies (used
 * by the setup-screen document flow) if either changes. Built on the generic
 * primitives in server/validation.mjs, same as server/glossary.mjs.
 */
import { isArrayOf, isNonEmptyString, isOptional, isStringArray, validateShape } from "./validation.mjs";

export const isGroundingQuestion = (value) =>
  validateShape(
    value,
    {
      id: isNonEmptyString,
      question: isNonEmptyString,
      options: isOptional(isStringArray),
    },
    ["id", "question"],
  );

export const isGroundingQuestionArray = isArrayOf(isGroundingQuestion);

export const isDocSummary = (value) =>
  validateShape(
    value,
    {
      documentType: isNonEmptyString,
      issuingAgency: isNonEmptyString,
      purpose: isNonEmptyString,
      englishSummary: isNonEmptyString,
      keyFields: isStringArray,
      questions: isGroundingQuestionArray,
    },
    ["documentType", "issuingAgency", "purpose", "englishSummary", "keyFields", "questions"],
  );
