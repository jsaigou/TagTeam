/**
 * Vocalized fillers: short natural utterances the avatar speaks while a
 * background worker LLM is searching / fetching / parsing (per product spec,
 * silence on a live call reads as "dead air" — a filler reassures the user
 * that work is happening without committing to an answer).
 */

export type FillerLang = "en" | "ja";

const EN_FILLERS = [
  "Hmm… Let me think…",
  "Hmmm… I see…",
  "Oooh… ok, ok…",
  "Almost ready…",
  "Let me look this up…",
  "Right, right…",
];

const JA_FILLERS = [
  "んんん…なるほど。",
  "あっ、そうですね。",
  "そろそろ出来ます。",
  "ええと…",
  "はいはい、少し待ってください。",
];

/**
 * Pick a random filler for the language. When `avoid` is given and the pool
 * has more than one entry, never return the same string twice in a row.
 */
export function pickFiller(lang: FillerLang, avoid?: string): string {
  const pool = lang === "ja" ? JA_FILLERS : EN_FILLERS;
  if (pool.length <= 1) return pool[0];
  let filler = pool[Math.floor(Math.random() * pool.length)];
  while (avoid !== undefined && filler === avoid) {
    filler = pool[Math.floor(Math.random() * pool.length)];
  }
  return filler;
}

/** Base gap between fillers, ms. */
export const FILLER_INTERVAL_MS = 7000;

/** Extra random jitter added on top of the interval, ms. */
export const FILLER_JITTER_MS = 3000;
