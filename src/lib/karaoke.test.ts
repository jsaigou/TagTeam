import { describe, expect, it } from "vitest";

import {
  estimateSpeechMs,
  KaraokeTracker,
  MS_PER_BEAT,
  splitKaraokeWords,
  stripMotionMarkup,
  wordProgressAt,
} from "./karaoke";

describe("splitKaraokeWords", () => {
  it("splits latin text on whitespace", () => {
    const words = splitKaraokeWords("Hello there, friend");
    expect(words.map((w) => w.text)).toEqual(["Hello", "there,", "friend"]);
    expect(words[1].pre).toBe(" ");
  });

  it("chops dense Japanese into ~2-character chunks", () => {
    const words = splitKaraokeWords("こんにちは、元気ですか");
    const joined = words.map((w) => w.text).join("");
    expect(joined).toBe("こんにちは、元気ですか");
    // 11 chars at ≥2 beats per emitted chunk → several small steps
    expect(words.length).toBeGreaterThanOrEqual(4);
    for (const w of words) expect([...w.text].length).toBeLessThanOrEqual(3);
  });

  it("keeps short mixed tokens whole", () => {
    const words = splitKaraokeWords("市役所 OK です");
    expect(words.map((w) => w.text)).toEqual(["市役所", "OK", "です"]);
  });
});

describe("estimateSpeechMs", () => {
  it("grows with length and stays positive", () => {
    const short = estimateSpeechMs("はい");
    const long = estimateSpeechMs("これはちょっと長い文章です、いろいろと書いてあります");
    expect(short).toBeGreaterThan(0);
    expect(long).toBeGreaterThan(short);
  });

  it("uses the nominal beat clock", () => {
    // 5 CJK chars = 5 beats
    expect(estimateSpeechMs("こんにちは")).toBe(5 * MS_PER_BEAT);
  });
});

describe("wordProgressAt", () => {
  const tl = {
    words: [
      { text: "ab", pre: "", beats: 1 },
      { text: "cd", pre: " ", beats: 1 },
      { text: "ef", pre: " ", beats: 2 },
    ],
    totalBeats: 4,
  };

  it("starts at the first word", () => {
    expect(wordProgressAt(tl, 0)).toEqual({ index: 0, frac: 0 });
  });

  it("walks forward through words", () => {
    expect(wordProgressAt(tl, 1.5)).toEqual({ index: 1, frac: 0.5 });
    expect(wordProgressAt(tl, 2)).toEqual({ index: 2, frac: 0 });
  });

  it("clamps past the end", () => {
    expect(wordProgressAt(tl, 99)).toEqual({ index: 2, frac: 1 });
  });
});

describe("KaraokeTracker", () => {
  it("progresses on the nominal clock and finishes complete", () => {
    const t = new KaraokeTracker();
    t.start("こんにちは、元気です", 1000);
    expect(t.progress(1000).done).toBe(false);
    expect(t.progress(1000).index).toBe(0);

    t.finish();
    const done = t.progress(2000);
    expect(done.done).toBe(true);
    expect(done.frac).toBe(1);
  });

  it("re-anchors when a sentence chunk starts — pauses do not stall the reveal", () => {
    const t = new KaraokeTracker();
    const text = "まずはこちら。それからあちら。";
    const words = splitKaraokeWords(text);
    t.start(text, 0);
    // Nothing sung yet.
    expect(t.progress(50).index).toBe(0);
    // The second sentence starts after a long pause (10s) — the reveal must
    // jump forward to its beginning rather than sit near the start.
    t.onChunk("それからあちら。", 10_000);
    const p = t.progress(10_000);
    // Everything through the end of the first sentence counts as sung.
    expect(p.index).toBeGreaterThanOrEqual(3);
    // …but the reveal has not clamped to the very end.
    expect(p.index).toBeLessThanOrEqual(words.length - 1);
    // And it keeps advancing from that anchor.
    const later = t.progress(12_000);
    expect(later.done).toBe(false);
    expect(later.index).toBeGreaterThanOrEqual(p.index);
  });

  it("ignores chunks that do not match the utterance", () => {
    const t = new KaraokeTracker();
    t.start("はい、わかりました", 0);
    t.onChunk("全く別の文", 500);
    expect(t.progress(600).index).toBeGreaterThanOrEqual(0);
  });
});

describe("stripMotionMarkup", () => {
  it("removes leading motion tags and collapses whitespace", () => {
    expect(stripMotionMarkup("[MOTION 01ABC:1] こんにちは")).toBe("こんにちは");
    expect(stripMotionMarkup("[motion x] [FACE y] おはよう [MOTION z]")).toBe("おはよう");
    expect(stripMotionMarkup("そのまま")).toBe("そのまま");
  });
});
