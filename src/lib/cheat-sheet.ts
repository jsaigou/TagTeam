/**
 * Cheat sheet: given the simulated script + glossary + the caller's answers,
 * produce a scan-friendly post-call cheat sheet (goal, if-then key phrases,
 * practice recommendations).
 */
import type { CheatSheet, GlossaryEntry, GroundingAnswer, SimScript } from "../shared/contract";
import { chatJson, isCheatSheet, type ChatMessage, type ChatOptions } from "./llm";
import { CHEAT_SHEET_SCHEMA_TEXT, CHEAT_SHEET_SYSTEM_PROMPT } from "../prompts/cheat-sheet";

export type GenerateCheatSheetOptions = {
  config?: ChatOptions["config"];
  timeoutMs?: number;
};

export type CheatSheetContext = {
  script: SimScript;
  glossary: GlossaryEntry[];
  answers: GroundingAnswer[];
  /** Phase 4 — web-researched reference digest about the office/agency,
   *  used to extract targetRules (hours/booking/required docs…). */
  reference?: string;
};

/** Render the script + glossary + answers (and optional reference digest) as the
 *  user message for the model. */
export function buildCheatSheetContext(context: CheatSheetContext): string {
  const turns = context.script.turns
    .map((turn) => `${turn.speaker}: ${turn.jp}${turn.en ? `（${turn.en}）` : ""}`)
    .join("\n");
  const glossary = context.glossary
    .map((entry) => `${entry.id} ${entry.kanji}（${entry.furigana}）= ${entry.en}`)
    .join("\n");
  const answers = context.answers
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

/** Generate the post-call cheat sheet for this simulation. */
export async function generateCheatSheet(
  context: CheatSheetContext,
  options: GenerateCheatSheetOptions = {},
): Promise<CheatSheet> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${CHEAT_SHEET_SYSTEM_PROMPT}\n\n【JSONスキーマ】\n${CHEAT_SHEET_SCHEMA_TEXT}`,
    },
    { role: "user", content: buildCheatSheetContext(context) },
  ];
  return chatJson(messages, isCheatSheet, "CheatSheet", {
    config: options.config,
    timeoutMs: options.timeoutMs ?? 90_000,
  });
}
