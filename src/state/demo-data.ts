import type {
  GlossaryEntry,
  GroundingAnswer,
  GroundingQuestion,
  SimScript,
} from "@/shared/contract";

/**
 * Demo-mode fixtures used while the ai-pipeline modules are unmerged.
 * Swap these out by merging src/lib/* — see pipeline.ts / connect.ts wrappers.
 */
export const DEMO_SUMMARY =
  "You are calling the ward office (区役所) to change the address on your residence card " +
  "(在留カード) after moving. You need to confirm the 14-day deadline, whether an appointment " +
  "is required, and which documents to bring on the day.";

export const DEMO_QUESTIONS: GroundingQuestion[] = [
  {
    id: "goal",
    question: "What do you want to accomplish in this call?",
    options: [
      "Change the address on my residence card",
      "Renew my residence card",
      "Enroll in National Health Insurance",
      "Ask about my pension",
    ],
  },
  {
    id: "when",
    question: "When do you need this done?",
    options: ["This week", "This month", "Just gathering information"],
  },
  {
    id: "docs",
    question: "Do you already have your documents ready?",
    options: ["Yes, I have them ready", "Not yet — I need a checklist"],
  },
];

export const DEMO_ANSWERS: GroundingAnswer[] = [
  { questionId: "goal", answer: "Change the address on my residence card" },
  { questionId: "when", answer: "This week" },
  { questionId: "docs", answer: "Yes, I have them ready" },
];

export const DEMO_GLOSSARY: GlossaryEntry[] = [
  {
    id: "g-ward-office",
    kanji: "区役所",
    furigana: "くやくしょ",
    en: "ward office",
    note: "your local government office for resident procedures.",
  },
  {
    id: "g-resident-registration",
    kanji: "住民登録",
    furigana: "じゅうみんとうろく",
    en: "resident registration",
    note: "the record of where you officially live.",
  },
  {
    id: "g-residence-card",
    kanji: "在留カード",
    furigana: "ざいりゅうカード",
    en: "residence card",
    note: "proof of legal residence; carry it at all times.",
  },
  {
    id: "g-address-change",
    kanji: "住所変更",
    furigana: "じゅうしょへんこう",
    en: "address change",
    note: "report a move within 14 days.",
  },
  {
    id: "g-deadline",
    kanji: "期限",
    furigana: "きげん",
    en: "deadline",
    note: "区役所 procedures have strict time limits.",
  },
  {
    id: "g-appointment",
    kanji: "予約",
    furigana: "よやく",
    en: "appointment",
    note: "ward offices often require a booked window slot.",
  },
  {
    id: "g-passport",
    kanji: "パスポート",
    furigana: "パスポート",
    en: "passport",
    note: "bring your passport for identity checks.",
  },
  {
    id: "g-window",
    kanji: "窓口",
    furigana: "まどぐち",
    en: "counter window",
    note: "the service desk where you submit documents.",
  },
  {
    id: "g-new-address",
    kanji: "新しい住所",
    furigana: "あたらしいじゅうしょ",
    en: "new address",
    note: "address proof such as a utility bill works.",
  },
  {
    id: "g-present",
    kanji: "提示",
    furigana: "ていじ",
    en: "to present / show",
    note: "you may be asked to show documents at the counter.",
  },
];

export const DEMO_SCRIPT: SimScript = {
  scenarioTitle: "Ward Office — Residence Card Address Change",
  turns: [
    {
      id: "t1",
      speaker: "bureaucrat",
      jp: "お世話になっております。区役所の住民課でございます。どのようなご用件でしょうか。",
      en: "Thank you for calling. This is the resident affairs division of the ward office. How may I help you?",
      vocab: ["g-ward-office", "g-resident-registration"],
    },
    {
      id: "t2",
      speaker: "user",
      jp: "先月引っ越しましたので、在留カードの住所変更をしたいです。",
      en: "I moved last month, so I'd like to change the address on my residence card.",
      vocab: ["g-residence-card", "g-address-change"],
    },
    {
      id: "t3",
      speaker: "bureaucrat",
      jp: "承知いたしました。在留カードの住所変更は、引っ越しから14日以内にお手続きください。新しい住所と在留カード、それからパスポートをご用意ください。",
      en: "Understood. Address changes must be processed within 14 days of moving. Please prepare your new address, your residence card, and your passport.",
      vocab: ["g-residence-card", "g-address-change", "g-deadline", "g-passport"],
    },
    {
      id: "t4",
      speaker: "user",
      jp: "14日以内ですね。今週中に伺えます。予約は必要ですか？",
      en: "Within 14 days, I see. I can come this week. Is an appointment required?",
      vocab: ["g-deadline", "g-appointment"],
    },
    {
      id: "t5",
      speaker: "bureaucrat",
      jp: "はい、住民課の窓口は予約制でございます。ご来庁の前にご予約をお願いいたします。",
      en: "Yes, our counter operates by appointment. Please book before you visit.",
      vocab: ["g-window", "g-appointment", "g-resident-registration"],
    },
    {
      id: "t6",
      speaker: "user",
      jp: "わかりました。予約をしたいです。",
      en: "Understood. I'd like to make an appointment.",
      vocab: ["g-appointment"],
    },
    {
      id: "t7",
      speaker: "bureaucrat",
      jp: "ありがとうございます。ご予約の際は、お名前と在留カード番号をご用意ください。",
      en: "Thank you. When booking, please have your name and residence card number ready.",
      vocab: ["g-residence-card"],
    },
    {
      id: "t8",
      speaker: "user",
      jp: "名前と在留カード番号ですね。当日は何を持って行けばいいですか？",
      en: "My name and card number. What should I bring on the day?",
      vocab: ["g-residence-card", "g-present"],
    },
    {
      id: "t9",
      speaker: "bureaucrat",
      jp: "当日は、在留カード、パスポート、そして新しい住所が確認できる書類をお持ちください。窓口でご提示をお願いします。",
      en: "On the day, please bring your residence card, your passport, and a document that confirms your new address. We'll ask you to present them at the counter.",
      vocab: ["g-residence-card", "g-passport", "g-new-address", "g-window", "g-present"],
    },
    {
      id: "t10",
      speaker: "user",
      jp: "新しい住所が確認できる書類ですね。わかりました。ありがとうございました。",
      en: "A document confirming my new address. Understood. Thank you very much.",
      vocab: ["g-new-address"],
    },
    {
      id: "t11",
      speaker: "bureaucrat",
      jp: "お気をつけてお越しください。失礼いたします。",
      en: "Please come safely. Goodbye.",
      vocab: [],
    },
  ],
};
