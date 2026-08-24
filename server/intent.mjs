/**
 * Phase 7b — intent detection without tool-calling (Phase 7 plan §7b.4).
 *
 * Fast paths first with NO llm call at all; otherwise one cheap,
 * schema-validated JSON call. The runner (server/hub.mjs) maps the returned
 * intent to a fixed action — the model classifies, it never chooses what
 * runs. `llmChat` is injected (not imported directly) so this stays a pure,
 * fast unit to test.
 */

const URL_RE = /^https?:\/\/\S+$/i;
const YES_RE = /^(yes|yeah|yep|yup|correct|right|that('|’)?s (it|right|correct)|sounds (right|good))\b/i;
const NO_RE = /^(no|nope|not (it|right|correct)|none of (these|those)|wrong)\b/i;

const INTENTS = new Set(["state_objective", "provide_url", "confirm", "reject", "question", "other"]);
const STRING_FIELDS = ["targetName", "url", "city", "objective"];

export function isIntentResult(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if (!INTENTS.has(value.intent)) return false;
  for (const key of STRING_FIELDS) {
    // `!= null` tolerates EXPLICIT nulls: models routinely emit `"city": null`
    // for optional fields, and strict `!== undefined` checks silently failed
    // every classification (the objective read as "other", nothing ran).
    const v = value[key];
    if (v != null && typeof v !== "string") return false;
  }
  if (value.confidence != null && typeof value.confidence !== "number") return false;
  return true;
}

const SYSTEM = `ユーザーの発話の意図を分類してJSONオブジェクトのみを返してください。
{"intent": "state_objective|provide_url|confirm|reject|question|other", "targetName": "電話したい窓口名（あれば）", "city": "市区町村（あれば）", "objective": "電話の用件の要約（state_objectiveのとき）", "confidence": 0から1の数値}
- state_objective: 電話したい用件・窓口を新たに（または改めて）述べた。
- provide_url: URLを示した。
- confirm / reject: 直前に提示された候補への肯定/否定。
- question: 質問。
- other: それ以外・雑談・不明。`;

/**
 * @param {string} text
 * @param {object} opts
 * @param {boolean} [opts.gateOpen] whether a confirmTarget gate is currently open —
 *   only then do bare "yes"/"no" fast-path to confirm/reject.
 * @param {(messages: object[], opts: object) => Promise<object>} opts.llmChat
 */
export async function classifyIntent(text, { gateOpen = false, llmChat } = {}) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { intent: "other" };
  if (URL_RE.test(trimmed)) return { intent: "provide_url", url: trimmed };
  if (gateOpen && YES_RE.test(trimmed)) return { intent: "confirm" };
  if (gateOpen && NO_RE.test(trimmed)) return { intent: "reject" };

  if (!llmChat) return { intent: "other" };

  const res = await llmChat(
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: trimmed },
    ],
    // No maxTokens override — see server/steps/identifyTarget.mjs's note on
    // the deployed reasoning model burning its budget on hidden reasoning
    // before `content`; a tight cap here silently returns empty text.
    { temperature: 0, responseFormat: { type: "json_object" } },
  );
  const content = res.choices?.[0]?.message?.content ?? "";
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { intent: "other" };
  }
  if (!isIntentResult(parsed)) return { intent: "other" };
  // Drop explicit nulls so callers see absent fields, not null traps.
  const clean = { ...parsed };
  for (const key of Object.keys(clean)) {
    if (clean[key] === null) delete clean[key];
  }
  return clean;
}
