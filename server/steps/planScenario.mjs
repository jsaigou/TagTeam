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

/** @param {{ docSummary?: object, answers?: Array, settings?: object, preset?: string, target?: object }} input */
export async function run({ docSummary, answers, settings, preset, target }, { signal, report }) {
  if (!docSummary) {
    throw Object.assign(
      new Error("Document summary is missing — please go back and re-upload the document."),
      { status: 400 },
    );
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
