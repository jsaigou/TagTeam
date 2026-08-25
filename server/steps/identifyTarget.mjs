/**
 * Phase 7b job step — turn a free-text objective ("book an appointment at
 * Mejiro Dental Clinic") into a structured target to research. One cheap,
 * schema-validated LLM call — same "the model classifies, the graph decides"
 * discipline as server/intent.mjs, not a free tool call. Runs in the "llm"
 * lane since it hits the same serialized homelab model.
 *
 * Page-grounded (readUrl): when the user's goal embeds a link, the graph
 * scrapes it first and hands the markdown in as `page` — the model then
 * reads the actual place instead of guessing a business from a domain
 * string, and infers what the caller likely wants (`objective`, plus an
 * English gloss `objectiveEn` for Luna's dialogue).
 *
 * A factory taking `llmChat` injected (like intent.mjs's caller-injected
 * chat fn), defaulting to providers.llmChat — keeps this unit testable
 * without network. The registered step is `createIdentifyTargetStep()`.
 */
import { llmChat as defaultLlmChat } from "../providers.mjs";

const SYSTEM = `利用者が電話したい日本の窓口・施設・企業を特定してください。JSONオブジェクトのみを返してください。
{"name": "施設・窓口の正式名称。必ず日本語（漢字・かな・カタカナ）表記。ローマ字・英語しか手がかりがない場合は、日本で実際に使われている呼び方に直すこと。特に私的の歯科診療所は「歯科医院」ではなく「歯科クリニック」「デンタルクリニック」などカタカナ表記が一般的（例: mejirodai dental clinic → 目白台デンタルクリニック）。役所・公的機関は公式名称のまま（例: 文京区役所）。空文字は不可",
 "alias": "同じ場所のローマ字・ドメイン風表記（あれば。例: mejirodai dental / mejirodaidental）",
 "city": "市区町村・都道府県（分かれば。不明なら省略）",
 "query": "ウェブ検索に使う日本語の検索クエリ（nameと施設種別の語を含む。例: 目白台デンタルクリニック 文京区 歯科）",
 "objective": "この相手への電話用件の要約（日本語で短く。例: 虫歯の治療予約を取りたい）",
 "objectiveEn": "The same objective in one short English sentence"}
- page（ウェブページの本文）が与えられた場合はそれを最優先の根拠にし、name はそのページ自身が名乗る公式名称をそのまま使ってください（推測で語尾を付け足さない）。所在地・案内内容から city/query/objective を決めてください。`;

function isResult(value) {
  if (typeof value !== "object" || value === null) return false;
  if (typeof value.name !== "string" || !value.name.trim()) return false;
  if (typeof value.query !== "string" || !value.query.trim()) return false;
  // `!= null`: models emit `"city": null` for unknown optionals — rejecting
  // that fails the whole step (same trap as intent.mjs's validator).
  for (const key of ["city", "alias", "objective", "objectiveEn"]) {
    if (value[key] != null && typeof value[key] !== "string") return false;
  }
  return true;
}

/** @param {{ goal: string, page?: {url: string, markdown: string} | null }} input */
export function createIdentifyTargetStep({ llmChat = defaultLlmChat } = {}) {
  /** @param {{ goal: string, page?: {url: string, markdown: string} | null }} input */
  async function run({ goal, page }, { signal }) {
    const text = String(goal ?? "").trim();
    const pageUrl = page && typeof page.url === "string" ? page.url : "";
    const pageMarkdown =
      page && typeof page.markdown === "string" ? page.markdown.trim().slice(0, 4000) : "";
    if (!text && !pageMarkdown) {
      throw Object.assign(new Error("No objective given yet — say what you need to do."), {
        status: 400,
      });
    }

    const userContent = [
      pageMarkdown ? `page (${pageUrl}):\n${pageMarkdown}` : "",
      text ? `依頼: ${text}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const res = await llmChat(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: userContent },
      ],
      // No maxTokens override — providers.mjs's 8192 default is deliberately
      // generous because the deployed model (gemma4-26b-a4b-nothink) is a reasoning model
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
      alias: parsed.alias?.trim() || undefined,
      objective: parsed.objective?.trim() || undefined,
      objectiveEn: parsed.objectiveEn?.trim() || undefined,
    };
  }
  return run;
}

export const step = {
  lane: "llm",
  // 150s per the Phase 7 plan §7b.6 deadline model for llm-lane steps.
  attemptMs: 150_000,
  label: "Figuring out who you need to call…",
  run: createIdentifyTargetStep(),
};

export { isResult as isIdentifyTargetResult };
