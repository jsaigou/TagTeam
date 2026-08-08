/**
 * Sample LLM JSON fixtures for unit tests. Each is exported both as the typed,
 * validated object AND as the raw JSON string a mock LLM would return as
 * `message.content`.
 */
import type { CheatSheet, GlossaryEntry, GroundingQuestion, SimScript } from "../shared/contract";
import type { DocSummary } from "../lib/doc-parser";

export const DOC_QUESTIONS_FIXTURE: GroundingQuestion[] = [
  {
    id: "q1",
    question: "Why are you calling about this notice?",
    options: [
      "I want to claim a medical expense tax deduction",
      "I want to apply for high-cost medical expense reimbursement",
      "I don't understand the amounts on the notice",
      "I need a reissue",
    ],
  },
  {
    id: "q2",
    question: "Do you know when to file your tax return?",
  },
];

export const DOC_SUMMARY_FIXTURE: DocSummary = {
  documentType: "国民健康保険 医療費のお知らせ",
  issuingAgency: "川崎市 健康保険課",
  purpose:
    "Annual notice summarizing the medical expenses paid under National Health Insurance, used to claim a medical expense tax deduction.",
  keyFields: ["医療費のお知らせ", "被保険者氏名", "被保険者番号", "医療費合計額", "自己負担額"],
  questions: DOC_QUESTIONS_FIXTURE,
};

export const DOC_SUMMARY_JSON = JSON.stringify(DOC_SUMMARY_FIXTURE);

export const SIM_GLOSSARY_FIXTURE: GlossaryEntry[] = [
  {
    id: "g1",
    kanji: "医療費のお知らせ",
    furigana: "いりょうひのおしらせ",
    en: "medical expense notice",
    note: "An annual statement from city hall listing your medical costs under National Health Insurance.",
  },
  {
    id: "g2",
    kanji: "健康保険課",
    furigana: "けんこうほけんか",
    en: "Health Insurance Division",
    note: "The city department handling National Health Insurance.",
  },
  {
    id: "g3",
    kanji: "ご住所",
    furigana: "ごじゅうしょ",
    en: "your address",
    note: "Used for identity verification on the phone.",
  },
  {
    id: "g4",
    kanji: "医療費控除",
    furigana: "いりょうひこうじょ",
    en: "medical expense deduction",
    note: "Lets you deduct medical costs above a threshold from your taxable income.",
  },
  {
    id: "g5",
    kanji: "確定申告",
    furigana: "かくていしんこく",
    en: "final tax return",
    note: "Filed once a year, roughly mid-February to mid-March.",
  },
  {
    id: "g6",
    kanji: "領収書",
    furigana: "りょうしゅうしょ",
    en: "receipt",
    note: "The notice can be attached in place of individual receipts.",
  },
  {
    id: "g7",
    kanji: "区役所",
    furigana: "くやくしょ",
    en: "ward office",
    note: "City hall branch for your ward.",
  },
  {
    id: "g8",
    kanji: "窓口",
    furigana: "まどぐち",
    en: "service counter",
    note: "Where you apply for or receive documents in person.",
  },
  {
    id: "g9",
    kanji: "再発行",
    furigana: "さいはっこう",
    en: "reissue",
    note: "Getting a replacement copy of the notice.",
  },
  {
    id: "g10",
    kanji: "申請",
    furigana: "しんせい",
    en: "application / request",
    note: "The act of formally requesting a service.",
  },
  {
    id: "g11",
    kanji: "ダウンロード",
    furigana: "だうんろーど",
    en: "download",
    note: "Copying the file to your device from the website.",
  },
  {
    id: "g12",
    kanji: "お電話ありがとうございます",
    furigana: "おでんわありがとうございます",
    en: "Thank you for calling",
    note: "Standard opening for a city office phone call.",
  },
  {
    id: "g13",
    kanji: "恐れ入りますが",
    furigana: "おそれいりますが",
    en: "I'm sorry to bother you, but",
    note: "Polite phrase used before asking the caller for something.",
  },
];

export const SIM_TURNS_FIXTURE = [
  {
    id: "t1",
    speaker: "bureaucrat" as const,
    jp: "お電話ありがとうございます。川崎市役所、健康保険課でございます。",
    en: "Thank you for calling. This is the Health Insurance Division of Kawasaki City Hall.",
    vocab: ["g12", "g2"],
  },
  {
    id: "t2",
    speaker: "user" as const,
    jp: "すみません、医療費のお知らせが届いたんですけど、どうしたらいいですか。",
    en: "Excuse me, I received a medical expense notice. What should I do with it?",
    vocab: ["g1"],
  },
  {
    id: "t3",
    speaker: "bureaucrat" as const,
    jp: "恐れ入りますが、まずお名前とご住所を確認させていただけますか。",
    en: "I'm sorry to bother you, but may I first confirm your name and address?",
    vocab: ["g13", "g3"],
  },
  {
    id: "t4",
    speaker: "user" as const,
    jp: "ジョン・アンです。宮前区の宮前に住んでいます。",
    en: "My name is John An. I live in Miyamae, Miyamae Ward.",
    vocab: ["g3"],
  },
  {
    id: "t5",
    speaker: "bureaucrat" as const,
    jp: "ありがとうございます。医療費のお知らせは、医療費控除の申告にご利用いただけます。1年間に支払った医療費が一定額を超えた場合に税金が安くなる制度で、このお知らせを領収書の代わりに添付します。",
    en: "Thank you. The medical expense notice can be used for your medical expense deduction filing. If the medical costs you paid in a year exceed a certain amount, your tax is reduced — this notice is attached in place of receipts.",
    vocab: ["g1", "g4", "g6"],
  },
  {
    id: "t6",
    speaker: "user" as const,
    jp: "なるほど。それで、もしお知らせをなくしてしまったら、どうすればいいですか。",
    en: "I see. So, if I lose the notice, what should I do?",
    vocab: ["g1", "g4", "g5"],
  },
  {
    id: "t7",
    speaker: "bureaucrat" as const,
    jp: "その場合は、お近くの区役所の窓口か、郵便で再発行を申請できます。ホームページからダウンロードも可能です。",
    en: "In that case, you can apply for a reissue at your local ward office counter or by mail. You can also download it from the website.",
    vocab: ["g7", "g8", "g9", "g10", "g11"],
  },
  {
    id: "t8",
    speaker: "user" as const,
    jp: "わかりました。とても助かりました。ほかに質問はありません。ありがとうございました。",
    en: "I understand. That's very helpful. I have no other questions. Thank you very much.",
    vocab: [],
  },
  {
    id: "t9",
    speaker: "bureaucrat" as const,
    jp: "どういたしまして。お電話ありがとうございました。失礼いたします。",
    en: "You're welcome. Thank you for calling. Goodbye.",
    vocab: ["g2", "g12"],
  },
] as const;

export const SIM_FIXTURE: { script: SimScript; glossary: GlossaryEntry[] } = {
  script: {
    scenarioTitle: "国民健康保険の医療費のお知らせについての問い合わせ",
    turns: SIM_TURNS_FIXTURE as unknown as SimScript["turns"],
  },
  glossary: SIM_GLOSSARY_FIXTURE,
};

/** Raw LLM payload for the sim generation request (script + glossary in one JSON). */
export const SIM_RAW_FIXTURE = {
  scenarioTitle: SIM_FIXTURE.script.scenarioTitle,
  turns: SIM_FIXTURE.script.turns,
  glossary: SIM_FIXTURE.glossary,
};

export const SIM_JSON = JSON.stringify(SIM_RAW_FIXTURE);

export const CHEAT_SHEET_FIXTURE: CheatSheet = {
  goal: "Ask how to use the medical expense notice for a tax deduction, and how to get it reissued.",
  keyPhrases: [
    {
      jp: "医療費のお知らせが届いたんですけど、どうしたらいいですか。",
      furigana: "いりょうひのおしらせがとどいたんですけど、どうしたらいいですか。",
      en: "I received the medical expense notice — what should I do with it?",
      when: "when you get the notice and don't know what to do",
    },
    {
      jp: "お名前とご住所を確認させていただけますか。",
      furigana: "おなまえとごじゅうしょをかくにんさせていただけますか。",
      en: "May I confirm your name and address?",
      when: "if the official asks to confirm your identity",
    },
    {
      jp: "医療費控除の申告にご利用いただけます。",
      furigana: "いりょうひこうじょのしんこくにごりよういただけます。",
      en: "You can use it for your medical expense deduction filing.",
      when: "if they explain what the notice is for",
    },
    {
      jp: "再発行を申請できます。",
      furigana: "さいはっこうをしんせいできます。",
      en: "You can apply for a reissue.",
      when: "if you lost the notice and ask for another copy",
    },
    {
      jp: "ホームページからダウンロードも可能です。",
      furigana: "ほーむぺーじからだうんろーどもかのうです。",
      en: "You can also download it from the website.",
      when: "if they offer alternatives to visiting in person",
    },
  ],
  practice: [
    "Practice saying your name and address (ご住所) clearly for identity checks.",
    "Drill the if-then phrase for 'what should I do with this notice'.",
    "Rehearse politely asking for a reissue (再発行).",
    "Review the medical expense total and co-payment amounts on the notice.",
  ],
};

export const CHEAT_SHEET_JSON = JSON.stringify(CHEAT_SHEET_FIXTURE);
