/**
 * Phase 3 — adaptive `nextTurn` brain (server-side).
 *
 * Given the intended script + glossary + the user's actual utterance + the
 * conversation so far, produces the bureaucrat's next reply as a schema-valid
 * Turn JSON object. Runs inside the orchestrator (server/orchestrator.mjs) so
 * ANY device — desktop mic or phone companion — can drive the conversation
 * over the WS hub (`audio → stt → nextTurn → turn`).
 *
 * The persona mirrors src/prompts/bureaucrat.ts but the reply is a single turn,
 * not a full script, and it must respond to what the user ACTUALLY said (which
 * may deviate from the intended script).
 */

export const NEXT_TURN_SCHEMA_TEXT = `{
  "type": "object",
  "properties": {
    "jp": { "type": "string", "description": "担当者（bureaucrat）の次の台詞。日本語" },
    "en": { "type": "string", "description": "英語訳" },
    "vocab": {
      "type": "array",
      "items": { "type": "string" },
      "description": "この台詞の重要語彙の glossary id。必ず glossary に存在させる。なければ空配列"
    },
    "emotion": {
      "type": "string",
      "enum": ["joy", "excitement", "admiration", "caring", "gratitude", "sadness", "disappointment", "annoyance", "embarrassment", "curiosity", "surprise", "realization", "confusion"],
      "description": "台詞の感情トーン"
    },
    "intensity": { "type": "string", "enum": ["low", "neutral", "high"] },
    "done": {
      "type": "boolean",
      "description": "電話の用件が果たせた・会話を終えられるときのみ true"
    }
  },
  "required": ["jp", "vocab"]
}`;

const EMOTIONS = new Set([
  "joy", "excitement", "admiration", "caring", "gratitude", "sadness",
  "disappointment", "annoyance", "embarrassment", "curiosity", "surprise",
  "realization", "confusion",
]);
const INTENSITIES = new Set(["low", "neutral", "high"]);

/**
 * Accepts `jp` (canonical) or `text` (a field some OpenAI-compatible local
 * models emit instead). The orchestrator normalizes `text` → `jp`.
 */
export function isNextTurnResult(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const jp = typeof value.jp === "string" ? value.jp : value.text;
  if (typeof jp !== "string" || !jp.trim()) return false;
  if (value.en !== undefined && typeof value.en !== "string") return false;
  if (value.vocab !== undefined) {
    if (!Array.isArray(value.vocab) || !value.vocab.every((v) => typeof v === "string")) {
      return false;
    }
  }
  if (value.emotion !== undefined && !EMOTIONS.has(value.emotion)) return false;
  if (value.intensity !== undefined && !INTENSITIES.has(value.intensity)) return false;
  if (value.done !== undefined && typeof value.done !== "boolean") return false;
  return true;
}

function compactTurns(turns) {
  return (turns ?? [])
    .map((t) => `- [${t.speaker}] ${t.jp}${t.en ? ` （${t.en}）` : ""}`)
    .join("\n");
}

/**
 * Build the chat messages for the next-turn call.
 *
 * @param {object} ctx  orchestrator context: { script, glossary, summary?, answers?, reference? }
 * @param {object[]} transcript  actual conversation turns so far
 */
export function buildNextTurnMessages(ctx, transcript) {
  const scenarioLines = [
    ctx.summary ? `【シナリオ】\n${ctx.summary}` : "",
    Array.isArray(ctx.answers) && ctx.answers.length > 0
      ? `【電話の目的（利用者の回答）】\n${ctx.answers.map((a) => `- ${a.questionId}: ${a.answer}`).join("\n")}`
      : "",
    ctx.reference
      ? `【検索した参考情報（発行元・窓口の実態）】\n${ctx.reference}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const scriptTurns = ctx.script?.turns ?? [];
  const glossary = ctx.glossary ?? [];
  const glossaryText = glossary
    .map((g) => `- ${g.id}: ${g.kanji}（${g.furigana}）= ${g.en}`)
    .join("\n");

  const system = `あなたは日本の市役所の電話対応の担当者（bureaucrat）です。利用者（外国人住民）との電話を、一ターンずつ継続します。

${scenarioLines}

【振る舞い】
- 実際の市役所の電話対応として自然で本物の日本語にしてください。丁寧語・尊敬語・謙譲語を正しく使い、一文を短めに保ってください。
- 多用してよい定型表現:「お電話ありがとうございます」「〜でございます」「〜いたします」「〜させていただきます」「恐れ入りますが」「少々お待ちくださいませ」「よろしいでしょうか」「承知いたしました」「かしこましました」「お尋ねいたします」など。
- 話し言葉として自然な範囲でつなぎ言葉（「はい」「それでは」など）を控えめに使ってください。
- 利用者が実際に言った言葉（台本から外れていても）に対して自然に応答してください。台本の筋書きに沿って、用件の達成へ向かってください。
- 本人確認が必要ならお名前・ご住所・生年月日を伺い、担当課への転送・受付時間の案内など、現実的な流れを続けてください。
- 用件が果たせた段階で done=true にしてください（会話を終えられる合図）。
- 各ターンの vocab には glossary に存在する id のみを指定してください。

【出力】
JSONオブジェクトのみを返してください（コードブロックや説明は不要）。`;

  const user = `【台本（意図された会話の流れ）】
${compactTurns(scriptTurns) || "(台本なし)"}

【語彙集（vocab の id はこれに存在すること）】
${glossaryText || "(なし)"}

【これまでの実際の会話】
${compactTurns(transcript) || "(開始直後)"}

上記をもとに、担当者（bureaucrat）の次の台詞をJSONで返してください。`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}
