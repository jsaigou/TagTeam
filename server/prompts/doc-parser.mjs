/**
 * Doc-parse system prompt + DocSummary JSON schema, mirrored from
 * `src/prompts/schemas.ts` (DOC_SUMMARY_SCHEMA) and `src/prompts/doc-parser.ts`
 * (DOC_PARSE_SYSTEM_PROMPT) for the server-side `parseDocument` job step
 * (Phase 7 plan §7b.5 migration step 5). Keep the schema/prompt text in sync
 * with the client copies if either changes.
 */

/** Structured doc summary extracted from a photo of a Japanese official document. */
export const DOC_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: {
      type: "string",
      description: "文書の種類（日本語）。例:「国民健康保険 医療費のお知らせ」",
    },
    issuingAgency: {
      type: "string",
      description: "発行元・担当部署（日本語）。例:「川崎市 健康保険課」",
    },
    purpose: {
      type: "string",
      description: "この文書が何のためのものか、英語で一文",
    },
    englishSummary: {
      type: "string",
      description:
        "A clear, plain-English summary of what this document is, who it is from, and what the recipient should do. 2-4 sentences written for someone who cannot read Japanese. Include any deadlines, amounts, or action items visible in the document.",
    },
    keyFields: {
      type: "array",
      items: { type: "string" },
      description: "文書に記載された重要項目（日本語のまま）。3〜6個",
    },
    questions: {
      type: "array",
      description: "電話の目的を確定する英語の質問。1〜2件。可能なら選択肢を付ける",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "question"],
        properties: {
          id: { type: "string", description: "例: q1" },
          question: { type: "string" },
          options: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    },
  },
  required: ["documentType", "issuingAgency", "purpose", "englishSummary", "keyFields", "questions"],
};

export const DOC_PARSE_SCHEMA_TEXT = JSON.stringify(DOC_SUMMARY_SCHEMA, null, 2);

export const DOC_PARSE_SYSTEM_PROMPT = `あなたは日本の行政文書に詳しいアシスタントです。利用者は日本で暮らす外国人居住者で、役所から届いた書類の写真を撮りました。写真の文書を解析し、指定されたJSONスキーマに従って英語と日本語で要約してください。

文書から以下を抽出してください。
- documentType: 文書の種類（日本語で、例「国民健康保険 医療費のお知らせ」）
- issuingAgency: 発行元・担当部署（日本語で、例「川崎市 健康保険課」）
- purpose: この文書が何のためのものか、英語で一文
- englishSummary: 英語で書かれた明確な要約（2〜4文）。この文書が何者で、誰から届いたもので、受取人が何をするべきかを説明してください。締切額、金額、必要な行動が文書に含まれている場合はそれも含めてください。日本語を読めない人向けに書いてください。
- keyFields: 文書に記載されている重要項目（日本語のまま、3〜6個）
- questions: 利用者がこの文書について役所に電話するとき、担当者に伝えるべき「電話の目的」を確定するための英語の質問を1〜2件。可能なら選択肢（options）を付けてください。

文書に写っていない情報は推測で埋めず、分かる範囲だけで構造化してください。回答は必ずJSONオブジェクトで返してください。`;
