/**
 * Bureaucrat persona prompt + simulation JSON schema, mirrored from
 * `src/prompts/schemas.ts` (SIM_SCHEMA) and `src/prompts/bureaucrat.ts`
 * (bureaucratSystemPrompt) for the server-side `planScenario` job step
 * (Phase 7 plan §7b.5 migration step 4). Keep the schema/prompt text in sync
 * with the client copies if either changes.
 */

const TURN_EMOTIONS = [
  "joy", "excitement", "admiration", "caring", "gratitude", "sadness",
  "disappointment", "annoyance", "embarrassment", "curiosity", "surprise",
  "realization", "confusion",
];

/** Simulated phone call script + glossary, produced in a single JSON object. */
export const SIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    scenarioTitle: {
      type: "string",
      description: "台本のタイトル（日本語）。例:「国民健康保険の医療費のお知らせについての問い合わせ」",
    },
    turns: {
      type: "array",
      description: "電話のやり取り。1ターン目は必ず bureaucrat、以降は交互。6〜10ターン",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "speaker", "jp", "vocab"],
        properties: {
          id: { type: "string", description: "例: t1, t2 ..." },
          speaker: { type: "string", enum: ["bureaucrat", "user"] },
          jp: { type: "string", description: "日本語の台詞" },
          en: { type: "string", description: "英語の訳" },
          vocab: {
            type: "array",
            items: { type: "string" },
            description: "この台詞の重要語彙の glossary id。必ず glossary に存在すること",
          },
          motion: { type: "string", description: "任意の Perxona モーション記法（例: [MOTION id:1]）" },
          emotion: {
            type: "string",
            enum: TURN_EMOTIONS,
            description: "bureaucrat の台詞の感情トーン（任意、bureaucrat のターンで指定）",
          },
          intensity: {
            type: "string",
            enum: ["low", "neutral", "high"],
            description: "感情の強さ（任意）",
          },
        },
      },
    },
    glossary: {
      type: "array",
      description: "台本全体の重要語彙集。turn.vocab で参照される id をすべて含めること",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "kanji", "furigana", "en"],
        properties: {
          id: { type: "string", description: "例: g1, g2 ..." },
          kanji: { type: "string", description: "語彙（漢字かな交じり）" },
          furigana: { type: "string", description: "読み仮名（ひらがな）" },
          en: { type: "string", description: "英語訳" },
          note: { type: "string", description: "場面に応じたワンポイント・注意（任意）" },
        },
      },
    },
  },
  required: ["scenarioTitle", "turns", "glossary"],
};

export const SIM_SCHEMA_TEXT = JSON.stringify(SIM_SCHEMA, null, 2);

/**
 * Build the bureaucrat persona system prompt.
 *
 * @param {string} guidance  Japanese sentences describing the requested
 *   register/warmth (see VOICE_PRESETS below) plus the coaching directives
 *   from `server/coaching.mjs#buildCoachingGuidance`.
 */
export function bureaucratSystemPrompt(guidance) {
  return `あなたは日本の市役所の電話対応に精通したシナリオライターです。外国人居住者が役所に電話する場面のロールプレイ台本を、本物の日本語で作成します。

【bureaucrat の台詞】
- 実際の市役所の電話対応として自然で本物の日本語にしてください。丁寧語・尊敬語・謙譲語を正しく使い、教科書的すぎず、実在の窓口職員が話す速さ・リズムを意識してください。
- 多用してよい定型表現: 「お電話ありがとうございます」「〜でございます」「〜いたします」「〜させていただきます」「恐れ入りますが」「少々お待ちくださいませ」「よろしいでしょうか」「承知いたしました」「かしこまりました」「お尋ねいたします」「失礼いたします」など。
- 話し言葉として自然な範囲で、つなぎ言葉（「はい」「それでは」「ええと」「あのう」）を控えめに使い、一文を短めに保ってください。長い文は電話では不自然です。
- bureaucrat の各ターンには emotion と intensity を指定してください（台詞の感情トーンと強さ）。

【user の台詞】
- 日本語学習者が実際に言える、自然で簡単めの丁寧語（です・ます調）にしてください。長すぎず、電話で読める長さにしてください。

【構成】
- 6〜10ターン。1ターン目は必ず bureaucrat（電話を受ける第一声）、以降は bureaucrat と user が交互に話すこと。
- 実際にresidentが遭遇する現実的なやり取りを含めてください。例: 本人確認（お名前・ご住所・生年月日）、収入・世帯状況の確認、在留カードの案内、担当課への転送、窓口・受付時間の案内、書類の再発行・送付依頼、お待ちいただく間のつなぎなど。
- すべての台詞に英語訳（en）を付けてください。
- 各ターンの vocab には、その台詞で重要な語彙の glossary id を指定してください。vocab の id は必ず glossary に存在させてください。

【役割・難易度・ペース・雰囲気】
${guidance}

【出力】
指定されたJSONスキーマ（turns と glossary）に完全に従ったJSONオブジェクトを返してください。glossary は台本全体の重要語彙を過不足なく含めてください。回答はJSONオブジェクトのみを返してください。`;
}

export const DEFAULT_VOICE_PRESET = "standard";

export const VOICE_PRESETS = {
  formal: {
    id: "formal",
    label: "Formal",
    guidance:
      "【雰囲気】極めて丁寧で格式のある対応にしてください。窓口職員らしい厳格さは保ちつつ、ゆっくり落ち着いた印象で、定型表現（〜でございます、〜させていただきます、恐れ入りますが）を多めに使ってください。",
  },
  standard: {
    id: "standard",
    label: "Standard",
    guidance:
      "【雰囲気】市役所の一般的な電話対応として、丁寧で自然な話し方にしてください。過度に格式張らず、かといって砕けすぎない、実際の職員らしい親切で穏やかな対応にしてください。",
  },
  friendly: {
    id: "friendly",
    label: "Friendly",
    guidance:
      "【雰囲気】親しみやすく温かい対応にしてください。外国人居住者にも伝わりやすいよう少しゆっくりめに、必要に応じてやさしい表現で案内してください。ただし丁寧語は崩さないでください。",
  },
};

/** Render the doc summary + grounding answers as the user message for the model. */
export function buildSimulationContext(docSummary, answers, reference) {
  const lines = [
    "【解析した書類】",
    `文書の種類: ${docSummary.documentType}`,
    `発行元: ${docSummary.issuingAgency}`,
    `目的: ${docSummary.purpose}`,
    `重要項目: ${docSummary.keyFields.join("、")}`,
    "",
    "【電話の目的（利用者の回答）】",
    ...answers.map((a) => `- ${a.questionId}: ${a.answer}`),
  ];
  if (reference) {
    lines.push("", "【検索した参考情報（発行元・窓口の実態）】", reference);
  }
  lines.push(
    "",
    "上記の情報をもとに、市役所の担当者との電話のやり取りを台本化してください。1ターン目は必ず担当者（bureaucrat）の応答で始めてください。",
  );
  return lines.join("\n");
}
