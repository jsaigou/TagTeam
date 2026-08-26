/**
 * Phase 7b job step — the server-side migration of `src/lib/sim-engine.ts`'s
 * `generateSimulation` (Phase 7 plan §7b.5 migration step 4). Ported rather
 * than re-derived: `bureaucratSystemPrompt`/`buildSimulationContext`/
 * `VOICE_PRESETS` mirror `server/prompts/bureaucrat.mjs`, and the response
 * validation + reconciliation mirrors `server/glossary.mjs` (both ports of
 * the client copies — see those files' headers).
 *
 * Consumes slice 2's confirmed target: `confirmTarget`/`extractTargetRules`
 * (a `TargetProfile`, src/shared/contract.ts) replace the old free-text
 * `reference` digest that `ReferenceSearch.tsx` used to hand to the client
 * pipeline — same role, better grounding (structured rules with citations
 * instead of a raw search-hit blob), and gated on user confirmation per
 * architecture principle 6 ("never wrong-country info silently").
 */
import { llmChat } from "../providers.mjs";
import { buildCoachingGuidance } from "../coaching.mjs";
import {
  DEFAULT_VOICE_PRESET,
  SIM_SCHEMA_TEXT,
  VOICE_PRESETS,
  bureaucratSystemPrompt,
  buildSimulationContext,
} from "../prompts/bureaucrat.mjs";
import { isSimulationRaw, reconcileSimulation } from "../glossary.mjs";
import { assembleScript, hasAssemblyContent } from "../scenario-assembly.mjs";

// Sprint 1 (Switchboard Plan) — "classify, then fill": below this confidence,
// a classifyScenario match isn't trusted enough to skip generation. A
// mis-fire here doesn't just waste the fast path, it hands the learner a
// script about the WRONG errand — the threshold exists to make that rare,
// not to save one LLM call.
const ASSEMBLY_CONFIDENCE_THRESHOLD = 0.6;

/** Render the confirmed `TargetProfile` as the same kind of free-text digest
 *  `buildSimulationContext`'s "【検索した参考情報】" section expects. Exported
 *  for steps/cheatSheet.mjs, whose user message carries the same digest. */
export function buildReferenceDigest(target) {
  if (!target?.name) return undefined;
  const lines = ["【確認済みの窓口】", `名前: ${target.name}`];
  if (target.address) lines.push(`住所: ${target.address}`);
  if (target.url) lines.push(`URL: ${target.url}`);
  const rules = Array.isArray(target.rules) ? target.rules : [];
  if (rules.length) {
    lines.push("", "【窓口ルール】");
    for (const r of rules) lines.push(`- (${r.kind}) ${r.rule} — ${r.source}`);
  }
  return lines.join("\n");
}

/** Mirrors `parseJsonObject`'s fenced-code-block tolerance (`src/lib/llm.ts`). */
function parseJsonContent(content) {
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1];
  return JSON.parse(text);
}

/** @param {{ docSummary?: object, answers?: Array, settings?: object, preset?: string, target?: object, goal?: string, leafId?: string | null, confidence?: number }} input */
export async function run(
  { docSummary, answers, settings, preset, target, goal, leafId, confidence },
  { signal, report },
) {
  // Sprint 1's fast path: a confident classification into a leaf with real
  // prebuilt content skips generation entirely — the script comes from
  // native-authored module/vocab-pack lines plus the confirmed target's real
  // facts (name, posted rules), not an LLM writing from a blank page. Any
  // leaf without content, or a classification too unsure to trust, falls
  // through to the unchanged full-generation path below — that's what keeps
  // "handle anything thrown at it" true regardless of taxonomy coverage.
  if (
    leafId &&
    target?.name &&
    hasAssemblyContent(leafId) &&
    (confidence == null || confidence >= ASSEMBLY_CONFIDENCE_THRESHOLD)
  ) {
    report({ detail: "Using a prebuilt script for this kind of call…", progress: 0.9 });
    return assembleScript(leafId, { target, preset });
  }

  // Document-less runs are first-class now (URL-only or spoken objectives):
  // synthesize the context block the sim prompt expects from what we DO know.
  if (!docSummary) {
    docSummary = {
      documentType: "なし（書類なし・ウェブページ／口頭の用件）",
      issuingAgency: target?.name ?? "",
      purpose: goal || target?.name || "市区役所への電話",
      englishSummary: goal || target?.name || "A phone call to a municipal office",
      keyFields: [],
    };
  }

  const voice = VOICE_PRESETS[preset] ?? VOICE_PRESETS[DEFAULT_VOICE_PRESET];
  const coaching = settings ? buildCoachingGuidance(settings) : "";
  // voice.guidance already carries its own 【雰囲気】 header.
  const guidance = [coaching, voice.guidance].filter(Boolean).join("\n");
  const reference = buildReferenceDigest(target);

  report({ detail: "Writing your practice script…", progress: 0.3 });
  // No maxTokens override — providers.mjs's 8192 default is deliberately
  // generous (see identifyTarget.mjs's note on the deployed reasoning model
  // burning its budget on hidden reasoning_content before `content`).
  const res = await llmChat(
    [
      {
        role: "system",
        content: `${bureaucratSystemPrompt(guidance)}\n\n【JSONスキーマ】\n${SIM_SCHEMA_TEXT}`,
      },
      { role: "user", content: buildSimulationContext(docSummary, answers ?? [], reference) },
    ],
    { temperature: 0.2, responseFormat: { type: "json_object" }, signal },
  );
  const content = res.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = parseJsonContent(content);
  } catch {
    throw Object.assign(new Error("Could not generate a practice script from that."), { status: 502 });
  }
  if (!isSimulationRaw(parsed)) {
    throw Object.assign(new Error("Could not generate a practice script from that."), { status: 502 });
  }

  report({ detail: "Checking the script…", progress: 0.85 });
  return reconcileSimulation({
    script: { scenarioTitle: parsed.scenarioTitle, turns: parsed.turns },
    glossary: parsed.glossary,
  });
}

export const step = {
  lane: "llm",
  // 150s per the Phase 7 plan §7b.6 deadline model for llm-lane steps — same
  // budget as identifyTarget/extractTargetRules; a full 6-10 turn script +
  // glossary is at least as much generation work.
  attemptMs: 150_000,
  label: "Writing your practice script…",
  run,
};
