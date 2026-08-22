/**
 * Phase 7b job step — the server-side migration of `src/lib/cheat-sheet.ts`'s
 * `generateCheatSheet` (Phase 7 plan §7b.5 migration step 7). Ported rather
 * than re-derived: the prompt/schema live in `server/prompts/cheat-sheet.mjs`
 * and the context builder + validators in `server/cheat-sheet.mjs`, both
 * mirrors of the client copies.
 *
 * Runs SPECULATIVELY (graph.mjs marks the node) the moment `planScenario`
 * delivers — i.e. while the user is still rehearsing — so the sheet is ready
 * before they press Finish instead of making them wait through a fresh LLM
 * call at the end. Speculative priority keeps it behind Luna's blocking chat
 * turns in the concurrency-1 llm lane; a failed/canceled run simply leaves
 * the client's existing Finish-time generation as the fallback.
 */
import { llmChat } from "../providers.mjs";
import {
  CHEAT_SHEET_SCHEMA_TEXT,
  CHEAT_SHEET_SYSTEM_PROMPT,
} from "../prompts/cheat-sheet.mjs";
import { buildCheatSheetContext, isCheatSheet } from "../cheat-sheet.mjs";
import { buildReferenceDigest } from "./planScenario.mjs";

/** Mirrors `parseJsonObject`'s fenced-code-block tolerance (`src/lib/llm.ts`). */
function parseJsonContent(content) {
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1];
  return JSON.parse(text);
}

/** @param {{ script?: object, glossary?: Array, answers?: Array, target?: object }} input */
export async function run({ script, glossary, answers, target }, { signal, report }) {
  if (!script?.turns?.length) {
    throw Object.assign(
      new Error("No practice script to summarize — finish a scenario first."),
      { status: 400 },
    );
  }

  const reference = buildReferenceDigest(target);
  report({ detail: "Summarizing what you practiced…", progress: 0.3 });
  // No maxTokens override — see identifyTarget.mjs's note on the deployed
  // reasoning model burning its budget on reasoning_content before `content`.
  const res = await llmChat(
    [
      {
        role: "system",
        content: `${CHEAT_SHEET_SYSTEM_PROMPT}\n\n【JSONスキーマ】\n${CHEAT_SHEET_SCHEMA_TEXT}`,
      },
      { role: "user", content: buildCheatSheetContext({ script, glossary, answers, reference }) },
    ],
    { temperature: 0.2, responseFormat: { type: "json_object" }, signal },
  );
  const content = res.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = parseJsonContent(content);
  } catch {
    throw Object.assign(new Error("Could not generate a cheat sheet from that."), { status: 502 });
  }
  if (!isCheatSheet(parsed)) {
    throw Object.assign(new Error("Could not generate a cheat sheet from that."), { status: 502 });
  }

  report({ detail: "Checking the cheat sheet…", progress: 0.85 });
  return parsed;
}

export const step = {
  lane: "llm",
  // 150s per the Phase 7 plan §7b.6 deadline model for llm-lane steps — the
  // sheet digests the whole script + glossary, so it's real generation work.
  attemptMs: 150_000,
  label: "Preparing your cheat sheet…",
  run,
};
