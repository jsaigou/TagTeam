import type { CheatSheet, GlossaryEntry, SimScript } from "../shared/contract";
import { PRACTICE_AVATAR_ID, PRACTICE_SCENE_ID } from "../lib/presets";

/**
 * Canned "book a dentist appointment" demo — a one-click path that bypasses the
 * LLM so the demo is reliable. Seeds the full flow (scenario, script, glossary,
 * cheat sheet). Uses the default anime scene as the backdrop.
 *
 * The receptionist checks: first visit? (初診) and My Number card (マイナンバーカード)
 * — the modern identity document at Japanese clinics.
 */
export const DENTIST_DEMO = {
  scenario: {
    avatarId: PRACTICE_AVATAR_ID, // cc066_male_waiter plays the clinic receptionist
    sceneId: PRACTICE_SCENE_ID,
    voiceId: "01KZFHK5FX4D4CFVKN9TXAJSBX", // Male - warm and expressive (JP)
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
        jp: "かしこまりました。お名前と、初診でいらっしゃいますか。",
        en: "Certainly. May I have your name, and is this your first visit with us?",
        vocab: ["g_certainly", "g_name", "g_firstvisit"],
      },
      {
        id: "t4",
        speaker: "user",
        jp: "田中です。はい、初めてです。",
        en: "I'm Tanaka. Yes, this is my first visit.",
        vocab: ["g_name", "g_firstvisit"],
      },
      {
        id: "t5",
        speaker: "bureaucrat",
        jp: "ありがとうございます。マイナンバーカードはお持ちですか。",
        en: "Thank you. Do you have your My Number card?",
        vocab: ["g_mynumber"],
      },
      {
        id: "t6",
        speaker: "user",
        jp: "はい、持っています。",
        en: "Yes, I have it.",
        vocab: ["g_mynumber"],
      },
      {
        id: "t7",
        speaker: "bureaucrat",
        jp: "ありがとうございます。ご希望の日時はございますか。",
        en: "Thank you. Do you have a preferred date and time?",
        vocab: ["g_schedule"],
      },
      {
        id: "t8",
        speaker: "user",
        jp: "来週の水曜日の午前中はどうですか。",
        en: "How about next Wednesday morning?",
        vocab: ["g_schedule", "g_nextweek"],
      },
      {
        id: "t9",
        speaker: "bureaucrat",
        jp: "承知いたしました。来週の水曜日、午前十時でご予約をお取りいたします。初診の際はマイナンバーカードをご持参ください。",
        en: "Understood. We've reserved next Wednesday at 10 AM. Please bring your My Number card for your first visit.",
        vocab: ["g_reservation", "g_firstvisit", "g_mynumber"],
      },
      {
        id: "t10",
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
    { id: "g_name", kanji: "お名前", furigana: "おなまえ", en: "your name", note: "Polite form of 名前." },
    { id: "g_firstvisit", kanji: "初診", furigana: "しょしん", en: "first visit", note: "Clinics ask if you've been before to plan your care." },
    { id: "g_mynumber", kanji: "マイナンバーカード", furigana: "まいなんばーかーど", en: "My Number card", note: "Your official ID card; clinics ask for it instead of an insurance card." },
    { id: "g_certainly", kanji: "かしこまりました", furigana: "かしこまりました", en: "certainly / understood", note: "Polite phrase staff use to confirm." },
    { id: "g_schedule", kanji: "日時", furigana: "にちじ", en: "date and time" },
    { id: "g_nextweek", kanji: "来週", furigana: "らいしゅう", en: "next week" },
    { id: "g_thanks", kanji: "ありがとうございます", furigana: "ありがとうございます", en: "thank you (polite)" },
  ] satisfies GlossaryEntry[],

  cheatSheet: {
    goal: "Book a first visit at Shibuya Dental Clinic and confirm you'll bring your My Number card.",
    keyPhrases: [
      {
        jp: "予約をしたいのですが。",
        furigana: "よやくを したいのですが",
        en: "I'd like to make an appointment.",
        when: "when you open the call",
      },
      {
        jp: "初診でいらっしゃいますか。",
        furigana: "しょしんで いらっしゃいますか",
        en: "Is this your first visit?",
        when: "when they ask if you've been before",
      },
      {
        jp: "はい、初めてです。",
        furigana: "はい、はじめてです",
        en: "Yes, it's my first visit.",
        when: "if it's your first time",
      },
      {
        jp: "マイナンバーカードはお持ちですか。",
        furigana: "まいなんばーかーどは おもちですか",
        en: "Do you have your My Number card?",
        when: "when they ask for your ID",
      },
      {
        jp: "はい、持っています。",
        furigana: "はい、もっています",
        en: "Yes, I have it.",
        when: "when asked about your card",
      },
      {
        jp: "来週の水曜日の午前中はどうですか。",
        furigana: "らいしゅうの すいようびの ごぜんちゅうは どうですか",
        en: "How about next Wednesday morning?",
        when: "when they ask for a preferred time",
      },
      {
        jp: "初診の際はマイナンバーカードをご持参ください。",
        furigana: "しょしんの さいは まいなんばーかーどを ごじさんください",
        en: "Please bring your My Number card for your first visit.",
        when: "if they remind you about the card",
      },
    ],
    practice: [
      "Practice saying 初診 (first visit) and マイナンバーカード (My Number card) out loud.",
      "Say your name clearly: 田中です。",
      "Practice asking for a time: 来週の水曜日の午前中はどうですか。",
      "End every call with ありがとうございます。",
    ],
  } satisfies CheatSheet,
};
