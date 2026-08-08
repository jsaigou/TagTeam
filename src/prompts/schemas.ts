/**
 * JSON schemas for every structured LLM output.
 *
 * These are embedded into the system prompts as instructions: `response_format`
 * is plain `json_object` for maximum OpenAI-compatible coverage (OpenAI, Ollama,
 * LM Studio, ...). The shapes mirror the coordinator-owned contract types in
 * `src/shared/contract.ts` (import-only) — they are the single source of truth
 * for what we ask the model to produce.
 */

export type JsonSchema = {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/** Structured doc summary extracted from a photo of a Japanese official document. */
export const DOC_SUMMARY_SCHEMA: JsonSchema = {
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
  required: ["documentType", "issuingAgency", "purpose", "keyFields", "questions"],
};

/** Simulated phone call script + glossary, produced in a single JSON object. */
export const SIM_SCHEMA: JsonSchema = {
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

/** Post-call cheat sheet. */
export const CHEAT_SHEET_SCHEMA: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goal: { type: "string", description: "電話の目的を英語で一文" },
    keyPhrases: {
      type: "array",
      description: "if-then形式の定型フレーズ。3〜6件",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["jp", "furigana", "en", "when"],
        properties: {
          jp: { type: "string", description: "その場で言う日本語" },
          furigana: { type: "string", description: "読み仮名（ひらがな）" },
          en: { type: "string", description: "英語訳" },
          when: { type: "string", description: "いつ使うか（if ...）例:「if they ask for your residence card number」" },
        },
      },
    },
    practice: {
      type: "array",
      items: { type: "string" },
      description: "次回のために練習すべき項目（英語の短い指示）。3〜5件",
    },
  },
  required: ["goal", "keyPhrases", "practice"],
};
