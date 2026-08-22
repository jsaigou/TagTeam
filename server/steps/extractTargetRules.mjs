/**
 * Phase 7b job step — once `confirmTarget` resolves, scrape the confirmed
 * page and extract office rules (hours/booking/required docs/…) as
 * TargetRule[] (src/shared/contract.ts), producing the TargetProfile that
 * later feeds `planScenario`/`cheatSheet` (not yet migrated — see the Phase 7
 * plan §7b.5). Reuses steps/scrape.mjs's `run()` directly rather than
 * re-deriving a fetch, same "port, don't re-derive" rule as the rest of 7b.
 */
import { run as scrapeRun } from "./scrape.mjs";
import { llmChat } from "../providers.mjs";

const RULE_KINDS = new Set(["hours", "booking", "required_docs", "cancellation", "fees", "notes"]);

const SYSTEM = `以下のウェブページ内容から、この窓口・施設についてのルールを抽出してJSONオブジェクトのみを返してください。
{"address": "住所（ページに無ければ空文字）", "rules": [{"rule": "簡潔な一文", "kind": "hours|booking|required_docs|cancellation|fees|notes", "source": "根拠となる抜粋または要約"}]}
ルールが見つからない場合は "rules": [] としてください。`;

/** @param {{ candidate?: { name?: string, url?: string } }} input */
export async function run({ candidate }, { signal, report }) {
  if (!candidate?.url) {
    throw Object.assign(new Error("No confirmed target to read up on."), { status: 400 });
  }

  report({ detail: `Reading ${candidate.url}…` });
  const { markdown } = await scrapeRun({ url: candidate.url }, { signal, report: () => {} });

  report({ detail: "Extracting office details…", progress: 0.6 });
  const res = await llmChat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: markdown.slice(0, 6000) },
    ],
    // No maxTokens override — see identifyTarget.mjs's note on the deployed
    // reasoning model burning its budget on reasoning_content before `content`.
    { temperature: 0, responseFormat: { type: "json_object" }, signal },
  );
  const content = res.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { address: "", rules: [] };
  }
  const rawRules = Array.isArray(parsed?.rules) ? parsed.rules : [];
  const rules = rawRules
    .filter((r) => r && typeof r.rule === "string" && r.rule.trim())
    .map((r, i) => ({
      id: `rule-${i + 1}`,
      rule: r.rule.trim(),
      kind: RULE_KINDS.has(r.kind) ? r.kind : "notes",
      source: typeof r.source === "string" && r.source.trim() ? r.source.trim() : candidate.url,
    }));

  return {
    name: candidate.name,
    url: candidate.url,
    address: typeof parsed?.address === "string" && parsed.address.trim() ? parsed.address.trim() : undefined,
    rules,
  };
}

export const step = {
  lane: "llm",
  // 150s per the Phase 7 plan §7b.6 deadline model for llm-lane steps — this
  // one does a scrape THEN an llm call, and the deployed reasoning model
  // (gemma4-26b-a4b-nothink) genuinely needs the room (measured >90s against real
  // SearXNG/Firecrawl/LLM homelab backends during this slice's smoke test).
  attemptMs: 150_000,
  label: (input) => `Reading up on ${input?.candidate?.name ?? "the office"}…`,
  run,
};
