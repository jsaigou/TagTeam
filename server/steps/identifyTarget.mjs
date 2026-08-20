/**
 * Phase 7b job step — turn a free-text objective ("book an appointment at
 * Mejiro Dental Clinic") into a structured target to research. One cheap,
 * schema-validated LLM call — same "the model classifies, the graph decides"
 * discipline as server/intent.mjs, not a free tool call. Runs in the "llm"
 * lane since it hits the same serialized homelab model.
 */
import { llmChat } from "../providers.mjs";

const SYSTEM = `利用者が電話したい日本の窓口・施設・企業を特定してください。JSONオブジェクトのみを返してください。
{"name": "施設・窓口名（不明でも最も近い推測を入れる。空文字は不可）", "city": "市区町村・都道府県（分かれば。不明なら省略）", "query": "ウェブ検索に使う日本語の検索クエリ"}`;

function isResult(value) {
  if (typeof value !== "object" || value === null) return false;
  if (typeof value.name !== "string" || !value.name.trim()) return false;
  if (typeof value.query !== "string" || !value.query.trim()) return false;
  if (value.city !== undefined && typeof value.city !== "string") return false;
  return true;
}

/** @param {{ goal: string }} input */
export async function run({ goal }, { signal }) {
  const text = String(goal ?? "").trim();
  if (!text) {
    throw Object.assign(new Error("No objective given yet — say what you need to do."), {
      status: 400,
    });
  }

  const res = await llmChat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: text },
    ],
    // No maxTokens override — providers.mjs's 8192 default is deliberately
    // generous because the deployed model (gemma4-mtp) is a reasoning model
    // that burns tokens on hidden reasoning_content before `content` (see
    // src/lib/llm.ts's identical note); a tight cap here returns empty text.
    { temperature: 0, responseFormat: { type: "json_object" }, signal },
  );
  const content = res.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw Object.assign(new Error("Could not figure out who to call from that."), { status: 502 });
  }
  if (!isResult(parsed)) {
    throw Object.assign(new Error("Could not figure out who to call from that."), { status: 502 });
  }
  return {
    name: parsed.name.trim(),
    city: parsed.city?.trim() || undefined,
    query: parsed.query.trim(),
  };
}

export const step = {
  lane: "llm",
  // 150s per the Phase 7 plan §7b.6 deadline model for llm-lane steps.
  attemptMs: 150_000,
  label: "Figuring out who you need to call…",
  run,
};

export { isResult as isIdentifyTargetResult };
