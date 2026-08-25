/**
 * Regression: the confirmTarget gate takes research.results[0] as its guess,
 * and raw SearXNG order buried the official site under listicles
 * ("【2026年8月】東京都の歯医者 おすすめ17選") or surfaced same-name clinics
 * in other cities for romanized queries. rankResults must put the actual
 * place first — including when the identified name is Japanese-script and
 * only a romanized/domain alias can link it to e.g. mejirodaidental.jp.
 */
import { afterEach, describe, expect, it } from "vitest";
import { extractUrls, rankResults, run as researchRun, scoreResult } from "./steps/research.mjs";
import { config } from "./providers.mjs";

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

describe("extractUrls", () => {
  it("pulls http(s) links out of free text", () => {
    expect(extractUrls("see https://mejirodaidental.jp/ for details")).toEqual([
      "https://mejirodaidental.jp/",
    ]);
  });

  it("dedupes and caps at 2", () => {
    expect(
      extractUrls(
        "https://a.test/ https://a.test/ https://b.test/x https://c.test/y https://d.test/z",
      ),
    ).toEqual(["https://a.test/", "https://b.test/x"]);
  });

  it("returns [] for plain text", () => {
    expect(extractUrls("mejirodai dental clinic")).toEqual([]);
    expect(extractUrls(undefined)).toEqual([]);
  });
});

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

  it("uses the romanized alias to boost latin hits for a JP-script name", () => {
    // Regression for the mejirodai failure: identifyTarget now normalizes to
    // 目白台歯科医院, whose kanji appear in NEITHER candidate's latin host;
    // only the alias links the official site to mejirodaidental.jp.
    const ranked = rankResults([OTHER_CITY, LISTICLE, OFFICIAL], "目白台歯科医院", "mejirodai dental");
    expect(ranked[0].url).toBe("https://mejirodaidental.jp/");
    expect(scoreResult(OFFICIAL, "目白台歯科医院", "mejirodai dental")).toBeGreaterThan(
      scoreResult(OTHER_CITY, "目白台歯科医院", "mejirodai dental"),
    );
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

describe("research.run — direct pages vs search", () => {
  const savedSearch = { ...config.search };
  const savedScrape = { ...config.scrape };
  const realFetch = globalThis.fetch;
  afterEach(() => {
    config.search = savedSearch;
    config.scrape = savedScrape;
    globalThis.fetch = realFetch;
  });

  /** Fetch stub that records SearXNG queries and serves Firecrawl scrapes.
   *  `firecrawlUrl: ""` disables scraping (scrape step throws unconfigured
   *  BEFORE any network/guard work — deterministic, no DNS). */
  function stubNet({ searxngUrl = "http://searx.test", firecrawlUrl = "http://firecrawl.test", hits = [] } = {}) {
    config.search = { ...savedSearch, searxngUrl, language: "ja-JP" };
    config.scrape = { ...savedScrape, firecrawlUrl };
    const queries = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith(searxngUrl)) {
        queries.push(new URL(u).searchParams.get("q"));
        return { ok: true, status: 200, json: async () => ({ results: hits }) };
      }
      if (u.includes("/v1/scrape")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { markdown: "# 目白台歯科医院\n診療案内。予約は電話で。" } }),
        };
      }
      throw new Error(`unexpected fetch: ${u}`);
    };
    return queries;
  }

  it("reuses a prescraped page instead of refetching, tagged user-url", async () => {
    const queries = stubNet();
    const { results } = await researchRun({
      q: "https://mejirodaidental.example/",
      urls: ["https://mejirodaidental.example/"],
      prescraped: [
        { url: "https://mejirodaidental.example/", markdown: "# 目白台歯科医院\n診療案内。予約は電話で。" },
      ],
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      url: "https://mejirodaidental.example/",
      via: "user-url",
      title: "目白台歯科医院",
    });
    expect(queries).toEqual([]); // no text left → SearXNG never called
  });

  it("never turns a bare URL into a search query (the mejirodai regression)", async () => {
    // Link-only goal, no prescraped page: the direct scrape is disabled
    // (unconfigured) but SearXNG must NOT be queried with the domain string
    // — searching it is exactly how wrong same-name clinics used to surface.
    // (.example is RFC 2606-reserved, so nothing here touches real DNS.)
    const queries = stubNet({ firecrawlUrl: "" });
    await expect(
      researchRun({ q: "https://mejirodaidental.example/", urls: ["https://mejirodaidental.example/"] }),
    ).rejects.toThrow(/scraping is not configured/i);
    expect(queries).toEqual([]);
  });

  it("keeps direct pages on top of ranked search hits", async () => {
    const queries = stubNet({
      hits: [
        { title: "【2026年】歯医者 おすすめ17選", url: "https://medicaldoc.jp/list", content: "" },
        { title: "目白台歯科の予約", url: "https://epark.test/mejirodai", content: "" },
      ],
    });
    const { results } = await researchRun({
      q: "目白台歯科医院 文京区",
      prescraped: [{ url: "https://mejirodaidental.jp/", markdown: "# 目白台歯科医院\n公式。" }],
      name: "目白台歯科医院",
      alias: "mejirodai dental",
    });
    expect(queries).toEqual(["目白台歯科医院 文京区"]);
    expect(results[0].via).toBe("user-url");
    // The alias-boosted official booking page outranks the listicle.
    expect(results[1]).toMatchObject({ url: "https://epark.test/mejirodai", via: "search" });
    expect(results[2].url).toBe("https://medicaldoc.jp/list");
  });

  it("legacy caller (q only): URLs embedded in q are still scraped directly", async () => {
    const queries = stubNet({ hits: [] });
    const { results } = await researchRun({
      q: "please read https://mejirodaidental.example/ for me",
    });
    expect(results[0]).toMatchObject({
      url: "https://mejirodaidental.example/",
      via: "user-url",
      title: "目白台歯科医院",
    });
    expect(queries).toEqual(["please read for me"]);
  });
});
