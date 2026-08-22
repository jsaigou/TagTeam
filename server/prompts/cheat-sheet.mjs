/**
 * Cheat-sheet system prompt + CheatSheet JSON schema, mirrored from
 * `src/prompts/schemas.ts` (CHEAT_SHEET_SCHEMA) and `src/prompts/cheat-sheet.ts`
 * (CHEAT_SHEET_SYSTEM_PROMPT) for the server-side `cheatSheet` job step
 * (Phase 7 plan §7b.5 migration step 7). Keep the schema/prompt text in sync
 * with the client copies if either changes.
 */

/** Post-call cheat sheet. */
export const CHEAT_SHEET_SCHEMA = {
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
    targetRules: {
      type: "array",
      description: "本物の電話の前に知っておくべき窓口のルール（任意）。検索で得た参考情報に基づき、引用付きで0〜5件",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "rule", "source", "kind"],
        properties: {
          id: { type: "string", description: "例: r1, r2 ..." },
          rule: { type: "string", description: "ルールの内容（日本語）" },
          source: { type: "string", description: "引用元（発行元・サイト名・台本内の根拠）" },
          kind: {
            type: "string",
            enum: ["hours", "booking", "required_docs", "cancellation", "fees", "notes"],
            description: "ルールの種類",
          },
        },
      },
    },
  },
  required: ["goal", "keyPhrases", "practice"],
};

export const CHEAT_SHEET_SCHEMA_TEXT = JSON.stringify(CHEAT_SHEET_SCHEMA, null, 2);

export const CHEAT_SHEET_SYSTEM_PROMPT = `あなたは外国人居住者向けの日本語学習コーチです。完了した役所への電話シミュレーション（台本・語彙・利用者の回答・検索した参考情報）をもとに、その場で役立つ「カンニングシート」を英語で作成します。

- goal: この電話の目的を英語で一文に。
- keyPhrases: if-then形式の定型フレーズを3〜6件。when は「どんな場面で使うか」のきっかけ（例:「if they ask for your residence card number」）、jp はその場で言う日本語、furigana は読み仮名、en は英語訳。台本から学んだ実際に使える表現を選んでください。
- practice: 次回の電話に向けて練習すべき項目を英語の短い指示として3〜5件。
- targetRules: 本物の電話の前に知っておくべき窓口のルールを、検索した参考情報から抽出してください。rule は日本語、source は引用元（発行元・サイト名・台本内の根拠）を必ず付けてください。参考情報がない場合は空配列で返してください。

回答は必ず指定されたJSONスキーマに従ったJSONオブジェクトで返してください。`;
