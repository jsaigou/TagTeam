import type { CheatSheet, GlossaryEntry, SimScript } from "../shared/contract";
import { PRACTICE_AVATAR_ID, DEFAULT_SCENE_ID } from "../lib/presets";

/**
 * Canned "book a dentist appointment" demo — a one-click path that bypasses the
 * LLM so the demo is reliable. Seeds the full flow (scenario, script, glossary,
 * cheat sheet) and uses the hospital background for the practice call.
 */
export const DENTIST_DEMO = {
  scenario: {
    avatarId: PRACTICE_AVATAR_ID, // cc066_male_waiter plays the clinic receptionist
    sceneId: DEFAULT_SCENE_ID,
    voiceId: "01KZFHK5FX4D4CFVKN9TXAJSBX", // Male - warm and expressive (JP)
    background: "hospital" as const,
  },

  script: {
    scenarioTitle: "歯科医院への予約 — Booking a dentist appointment",
    turns: [
      {
        id: "t1",
        speaker: "bureaucrat",
        jp: "お電話ありがとうございます。渋谷デンタルクリニックの受付でございます。",
        en: "Thank you for calling. This is the reception desk of Shibuya Dental Clinic.",
        vocab: ["g_reception", "g_clinic"],
      },
      {
        id: "t2",
        speaker: "user",
        jp: "こんにちは。予約をしたいのですが。",
        en: "Hello. I'd like to make an appointment.",
        vocab: ["g_reservation"],
      },
      {
        id: "t3",
        speaker: "bureaucrat",
        jp: "かしこまりました。お名前と保険証の番号を教えていただけますか。",
        en: "Certainly. Could you tell me your name and your health insurance card number?",
        vocab: ["g_certainly", "g_insurance"],
      },
      {
        id: "t4",
        speaker: "user",
        jp: "田中です。保険証は持っています。",
        en: "I'm Tanaka. I have my insurance card with me.",
        vocab: ["g_name", "g_insurance"],
      },
      {
        id: "t5",
        speaker: "bureaucrat",
        jp: "ありがとうございます。ご希望の日時はございますか。",
        en: "Thank you. Do you have a preferred date and time?",
        vocab: ["g_schedule"],
      },
      {
        id: "t6",
        speaker: "user",
        jp: "来週の水曜日の午前中はどうですか。",
        en: "How about next Wednesday morning?",
        vocab: ["g_schedule", "g_nextweek"],
      },
      {
        id: "t7",
        speaker: "bureaucrat",
        jp: "承知いたしました。来週の水曜日、午前十時でご予約をお取りいたします。診察の前に保険証をご提示ください。",
        en: "Understood. We've reserved next Wednesday at 10 AM. Please show your insurance card before your examination.",
        vocab: ["g_reservation", "g_examination", "g_insurance"],
      },
      {
        id: "t8",
        speaker: "user",
        jp: "わかりました。ありがとうございます。",
        en: "Understood. Thank you.",
        vocab: ["g_thanks"],
      },
      {
        id: "t9",
        speaker: "bureaucrat",
        jp: "ありがとうございます。お待ちしております。",
        en: "Thank you. We look forward to seeing you.",
        vocab: ["g_thanks"],
      },
    ],
  } satisfies SimScript,

  glossary: [
    { id: "g_reception", kanji: "受付", furigana: "うけつけ", en: "reception desk", note: "The clinic's front desk where you book." },
    { id: "g_clinic", kanji: "クリニック", furigana: "くりにっく", en: "clinic", note: "A small medical practice." },
    { id: "g_reservation", kanji: "予約", furigana: "よやく", en: "appointment / reservation" },
    { id: "g_insurance", kanji: "保険証", furigana: "ほけんしょう", en: "health insurance card", note: "Bring this to every visit." },
    { id: "g_certainly", kanji: "かしこまりました", furigana: "かしこまりました", en: "certainly / understood", note: "Polite phrase staff use to confirm." },
    { id: "g_name", kanji: "お名前", furigana: "おなまえ", en: "your name", note: "Polite form of 名前." },
    { id: "g_schedule", kanji: "日時", furigana: "にちじ", en: "date and time" },
    { id: "g_nextweek", kanji: "来週", furigana: "らいしゅう", en: "next week" },
    { id: "g_examination", kanji: "診察", furigana: "しんさつ", en: "medical examination" },
    { id: "g_thanks", kanji: "ありがとうございます", furigana: "ありがとうございます", en: "thank you (polite)" },
  ] satisfies GlossaryEntry[],

  cheatSheet: {
    goal: "Book a dental appointment at Shibuya Dental Clinic.",
    keyPhrases: [
      {
        jp: "予約をしたいのですが。",
        furigana: "よやくを したいのですが",
        en: "I'd like to make an appointment.",
        when: "when you open the call",
      },
      {
        jp: "保険証を持っています。",
        furigana: "ほけんしょうを もっています",
        en: "I have my insurance card.",
        when: "when asked for your insurance card",
      },
      {
        jp: "来週の水曜日の午前中はどうですか。",
        furigana: "らいしゅうの すいようびの ごぜんちゅうは どうですか",
        en: "How about next Wednesday morning?",
        when: "when they ask for a preferred time",
      },
      {
        jp: "診察の前に保険証をご提示ください。",
        furigana: "しんさつの まえに ほけんしょうを ごていじください",
        en: "Please show your insurance card before the examination.",
        when: "if they remind you about the insurance card",
      },
    ],
    practice: [
      "Practice saying 予約 (appointment) and 保険証 (insurance card) out loud.",
      "Repeat the date you want: 来週の水曜日の午前中.",
      "Say ありがとうございます at the end of every call.",
    ],
  } satisfies CheatSheet,
};
