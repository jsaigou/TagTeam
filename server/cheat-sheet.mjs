/**
 * Phase 7b job-step support — the server-side migration of the cheat sheet's
 * context builder + response validators (Phase 7 plan §7b.5 migration
 * step 7). Ported rather than re-derived from `src/lib/cheat-sheet.ts`
 * (`buildCheatSheetContext`) and `src/lib/llm.ts` (`isCheatSheet`/
 * `isCheatSheetPhrase`, with `isTargetRule` shared shape-wise with
 * extractTargetRules' inline normalization), built on `server/validation.mjs`.
 * Keep in sync with the client copies if either changes.
 */
import {
  isArrayOf,
  isNonEmptyString,
  isOneOf,
  isOptional,
  isStringArray,
  validateShape,
} from "./validation.mjs";

/** Render the script + glossary + answers (and optional reference digest) as
 *  the user message for the model — mirrors src/lib/cheat-sheet.ts. */
export function buildCheatSheetContext(context) {
  const turns = (context.script?.turns ?? [])
    .map((turn) => `${turn.speaker}: ${turn.jp}${turn.en ? `（${turn.en}）` : ""}`)
    .join("\n");
  const glossary = (context.glossary ?? [])
    .map((entry) => `${entry.id} ${entry.kanji}（${entry.furigana}）= ${entry.en}`)
    .join("\n");
  const answers = (context.answers ?? [])
    .map((a) => `- ${a.questionId}: ${a.answer}`)
    .join("\n");

  const lines = [
    "【電話の台本】",
    turns,
    "",
    "【語彙集】",
    glossary,
    "",
    "【利用者の目的（回答）】",
    answers,
  ];
  if (context.reference) {
    lines.push("", "【検索した参考情報（窓口の実態）】", context.reference);
  }
  return lines.join("\n");
}

export const isCheatSheetPhrase = (value) =>
  validateShape(
    value,
    {
      jp: isNonEmptyString,
      furigana: isNonEmptyString,
      en: isNonEmptyString,
      when: isNonEmptyString,
    },
    ["jp", "furigana", "en", "when"],
  );

export const isTargetRule = (value) =>
  validateShape(
    value,
    {
      id: isNonEmptyString,
      rule: isNonEmptyString,
      source: isNonEmptyString,
      kind: isOneOf([
        "hours", "booking", "required_docs", "cancellation", "fees", "notes",
      ]),
    },
    ["id", "rule", "source", "kind"],
  );

export const isCheatSheet = (value) =>
  validateShape(
    value,
    {
      goal: isNonEmptyString,
      keyPhrases: isArrayOf(isCheatSheetPhrase),
      practice: isStringArray,
      targetRules: isOptional(isArrayOf(isTargetRule)),
    },
    ["goal", "keyPhrases", "practice"],
  );
