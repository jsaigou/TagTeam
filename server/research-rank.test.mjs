/**
 * Regression: the confirmTarget gate takes research.results[0] as its guess,
 * and raw SearXNG order buried the official site under listicles
 * ("【2026年8月】東京都の歯医者 おすすめ17選") or surfaced same-name clinics
 * in other cities for romanized queries. rankResults must put the actual
 * place first.
 */
import { describe, expect, it } from "vitest";
import { rankResults, scoreResult } from "./steps/research.mjs";

const OFFICIAL = {
  title: "目白台・雑司が谷の歯科・矯正歯科 | 目白台歯科",
  url: "https://mejirodaidental.jp/",
  snippet: "目白台歯科の公式サイトです。",
};
const LISTICLE = {
  title: "【2026年8月】東京都の歯医者 おすすめ17選",
  url: "https://medicaldoc.jp/clinic/2001085241/",
  snippet: "東京都のおすすめ歯医者を紹介。",
};
const OTHER_CITY = {
  title: "めじろ台 徒歩1分のめじろ台歯科クリニックは東京都八王子の…",
  url: "https://www.mejirodai-dc.com/",
  snippet: "八王子市のめじろ台歯科クリニック。",
};

describe("rankResults", () => {
  it("puts the official site above a listicle for a JP name", () => {
    const ranked = rankResults([LISTICLE, OTHER_CITY, OFFICIAL], "目白台歯科");
    expect(ranked[0].url).toBe("https://mejirodaidental.jp/");
    expect(ranked[ranked.length - 1].url).toBe(LISTICLE.url);
  });

  it("prefers an exact-name match over a same-name clinic in another city (latin)", () => {
    const exact = { title: "Mejirodai Dental Clinic", url: "https://mejirodaidental.jp/about" };
    const ranked = rankResults([OTHER_CITY, LISTICLE, exact], "Mejirodai Dental Clinic");
    expect(ranked[0].url).toBe("https://mejirodaidental.jp/about");
  });

  it("keeps relative order on ties (stable sort)", () => {
    const a = { title: "Alpha clinic", url: "https://a.test/" };
    const b = { title: "Beta clinic", url: "https://b.test/" };
    expect(rankResults([a, b], "")).toEqual([a, b]);
  });

  it("demotes directories even with no name to match", () => {
    const plain = { title: "Some page", url: "https://example.test/page" };
    const dir = { title: "おすすめ歯医者ランキング", url: "https://dirs.test/list" };
    expect(scoreResult(plain, "")).toBeGreaterThan(scoreResult(dir, ""));
  });
});
