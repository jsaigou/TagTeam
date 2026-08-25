/**
 * Sprint 0 job step (Switchboard Plan) — classify a free-text objective into
 * the scenario taxonomy (`server/scenario-taxonomy.mjs`), or `null` when it
 * doesn't clearly match a leaf. Same discipline as `identifyTarget.mjs` and
 * `server/intent.mjs`'s `classifyIntent`: one cheap, schema-validated LLM
 * call, no tool-calling, the graph decides what to do with the result — not
 * a free-form classifier.
 *
 * This step is deliberately NOT wired into `server/graph.mjs` yet. Sprint 0
 * ships the classifier as tested infrastructure; making it actually gate a
 * call's behavior (skip full generation, load a leaf's module + vocab-pack
 * skeleton once one exists) is Sprint 1's job, tied to its acceptance test —
 * see /Users/jon/.claude/plans/switchboard-scenario-plan.md. A `null`
 * classification is not a failure: it's what keeps "handle anything thrown
 * at it" true regardless of how complete the taxonomy is.
 *
 * A factory taking `llmChat` injected (mirrors identifyTarget.mjs), defaulting
 * to providers.llmChat — keeps this unit testable without network. The
 * registered step is `createClassifyScenarioStep()`.
 */
import { llmChat as defaultLlmChat } from "../providers.mjs";
import { LEAF_IDS, isLeafId, taxonomyListing } from "../scenario-taxonomy.mjs";

const SYSTEM = `利用者の電話の用件を、以下の分類のいずれかに当てはめてください。当てはまるものがなければ leafId は null にしてください（無理に当てはめないこと）。JSONオブジェクトのみを返してください。
{"leafId": "上記のいずれかのid、または null", "confidence": "0から1の数値（どれだけ確信があるか）"}

【分類】
${taxonomyListing()}`;

/** Below this length, text can't carry enough signal to classify — skip the
 *  LLM call entirely (mirrors classifyIntent's empty-text fast path). */
const MIN_TEXT_LENGTH = 4;

function isResult(value) {
  if (typeof value !== "object" || value === null) return false;
  // `!= null`: models emit explicit `"leafId": null` for "no match" — the
  // whole point of this field — so only reject non-null values that aren't
  // a real leaf id (same explicit-null trap identifyTarget.mjs/intent.mjs
  // both document).
  if (value.leafId != null && !isLeafId(value.leafId)) return false;
  if (value.confidence != null && typeof value.confidence !== "number") return false;
  return true;
}

/** @param {{ goal: string }} input */
export function createClassifyScenarioStep({ llmChat = defaultLlmChat } = {}) {
  /** @param {{ goal: string }} input */
  async function run({ goal }, { signal } = {}) {
    const text = String(goal ?? "").trim();
    if (text.length < MIN_TEXT_LENGTH) return { leafId: null };

    const res = await llmChat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: text },
      ],
      // No maxTokens override — see identifyTarget.mjs's note on the
      // deployed reasoning model burning its budget on hidden
      // reasoning_content before `content`; a tight cap returns empty text.
      { temperature: 0, responseFormat: { type: "json_object" }, signal },
    );
    const content = res.choices?.[0]?.message?.content ?? "";
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { leafId: null };
    }
    if (!isResult(parsed)) return { leafId: null };
    return {
      leafId: parsed.leafId ?? null,
      ...(typeof parsed.confidence === "number" ? { confidence: parsed.confidence } : {}),
    };
  }
  return run;
}

export const step = {
  lane: "llm",
  attemptMs: 150_000,
  label: "Figuring out what kind of call this is…",
  run: createClassifyScenarioStep(),
};

export { isResult as isClassifyScenarioResult, LEAF_IDS };
