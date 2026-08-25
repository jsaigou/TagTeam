/**
 * Phase 7b job step — SearXNG web search. Lifted from the body of the old
 * `GET /api/search` handler in server.mjs (Phase 2). Runs in the "net" lane.
 *
 * Objective-embedded URLs: if the user's message contains a link (e.g. they
 * paste a ward-office page as their whole task), those pages are scraped
 * DIRECTLY via the scrape step and become top candidates — a raw URL string
 * is a poor SearXNG query, and searching a domain-derived name is how
 * same-name wrong clinics used to win the confirm gate. The graph passes the
 * URLs explicitly (`urls`, extracted from the raw goal by graph.mjs) plus any
 * page already fetched earlier in the run (`prescraped` — the readUrl node's
 * result), so the goal's links survive identifyTarget/geolocate rewriting the
 * query text. Direct results are tagged `via: "user-url"`; confirmTarget
 * auto-confirms them (the user pasted that page themselves). Search still
 * runs on the remaining text to fill the remaining candidate slots.
 */
import { config } from "../providers.mjs";
import { run as scrapePage } from "./scrape.mjs";

const URL_IN_TEXT = /https?:\/\/[^\s)]+/gi;

/** Pull the http(s) URLs out of free text, deduped, max 2. Pure + exported
 *  for tests (graph.mjs uses it to shape the research node's input). */
export function extractUrls(text) {
  const matches = String(text ?? "").match(URL_IN_TEXT) ?? [];
  return [...new Set(matches)].slice(0, 2);
}

/** The goal text with links stripped — a URL is noise to SearXNG. Empty when
 *  the goal was ONLY link(s): searching a bare domain is exactly how
 *  same-name wrong clinics used to surface, so no query means no search. */
function searchQuery(q) {
  return String(q ?? "")
    .replace(URL_IN_TEXT, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* -- Name-aware result ranking ------------------------------------------- */
/* SearXNG's order is query-luck: Japanese local searches bury official sites
   under listicles ("…おすすめ17選"), and a romanized/English target name can
   surface SAME-NAME clinics in other cities. The confirm gate takes
   results[0] as its guess, so results are reranked against the identified
   target name before anything downstream sees them. Pure + exported for
   tests. */

const AGGREGATOR_PATTERNS = [
  // JP listicle/directory signals
  /おすすめ/, /ランキング/, /一覧/, /\d+\s*選/, /ガイド/, /比較/, /口コミ/, /地図/,
  /病院なび/, /エキテン/, /EPARK/i, /デンタルネット/, /医療ドットコム/, /クリニッ?クセレクト/, /byoin\.navi/i, /QLife/i,
  // EN equivalents
  /\bbest\b/i, /ranking/i, /\btop[- ]?\d+\b/i, /\blist\b/i, /review/i, /yelp/i, /tabelog/i,
];

function normText(s) {
  return String(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\u3000]+/g, "")
    .replace(/[|｜・・，,、。.:：;；"'()（）[\]{}<>＜＞\-–—~〜]/g, "");
}

/** Score one result against the normalized target name. Higher is better.
 *  `normalizedAlias` is the romanized/domain-style form of the same place
 *  (identifyTarget's `alias`), so a kanji name can still boost latin hits
 *  like the "mejirodaidental" run in mejirodaidental.jp. */
export function scoreResult(result, normalizedName, normalizedAlias) {
  const hay = normText(`${result.title} ${result.url}`);
  let score = 0;
  if (!normalizedName && !normalizedAlias) {
    // Nothing to match against — only demote obvious directories/listicles.
    return -AGGREGATOR_PATTERNS.reduce(
      (n, p) => n + (p.test(hay) ? 1 : 0),
      0,
    );
  }
  // Exact normalized-name containment is the strong signal ("目白台歯科",
  // "mejirodaidental.jp" folds to contain "mejirodaidentalclinic"-ish runs).
  if (normalizedName && hay.includes(normalizedName)) {
    score += 6;
  } else if (normalizedName) {
    // Longest matching PREFIX of the name (JP names are head-initial: 目白台
    // is the distinguishing part of 目白台歯科).
    let prefixLen = 0;
    for (let len = normalizedName.length; len >= 2; len--) {
      if (hay.includes(normalizedName.slice(0, len))) {
        prefixLen = len;
        break;
      }
    }
    if (prefixLen > 0) score += 4 * (prefixLen / normalizedName.length);
  }
  // Alias containment: "mejirodaidental" inside mejirodaidental.jp is nearly
  // as strong as the full name matching.
  if (normalizedAlias && normalizedAlias.length >= 4 && hay.includes(normalizedAlias)) {
    score += 5;
  }
  // Latin word overlap covers romanized URLs (mejirodai + dental + clinic)
  // against BOTH the name and its alias — a JP name alone yields no latin
  // words here.
  const words = [
    ...new Set(
      `${normalizedName ?? ""} ${normalizedAlias ?? ""}`
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3),
    ),
  ];
  if (words.length > 0) {
    const hit = words.filter((w) => hay.includes(w)).length;
    score += 3 * (hit / words.length);
  }
  // Directory/listicle pages are almost never the place itself.
  const aggHits = AGGREGATOR_PATTERNS.filter((p) => p.test(hay)).length;
  score -= Math.min(aggHits * 4, 8);
  return score;
}

/** Stable-sorted copy, best first. Results keep their relative order on ties. */
export function rankResults(results, name, alias) {
  const normalizedName = normText(name);
  const normalizedAlias = normText(alias);
  return results
    .map((r, i) => ({ r, i, score: scoreResult(r, normalizedName, normalizedAlias) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ r }) => r);
}

/** Derive a result title/snippet from scraped markdown (first heading/line). */
function describeMarkdown(markdown) {
  const lines = markdown
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const heading = lines.find((l) => l.startsWith("#"));
  const title = (heading ?? lines[0] ?? "")
    .replace(/^#+\s*/, "")
    .slice(0, 120);
  const body = lines
    .filter((l) => !l.startsWith("#") && !/^!?\[/.test(l))
    .join(" ")
    .replace(/[*_`>[\]()#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { title: title || "Web page", snippet: body.slice(0, 200) };
}

/** @param {{ q: string, urls?: string[], prescraped?: {url: string, markdown: string}[], name?: string, alias?: string }} input
 *  - `q` is the search query (geolocate's queryHint / identifyTarget's query
 *    / the raw goal). URLs embedded in it are still honored so the legacy
 *    `/api/search` caller (which passes only `q`) keeps working.
 *  - `urls` are links extracted from the user's raw goal by graph.mjs — they
 *    survive identifyTarget/geolocate rewriting `q`.
 *  - `prescraped` is a page an earlier node already fetched this run
 *    (readUrl's scrape) — reused instead of refetching.
 *  - `name`/`alias`: identified target for reranking hits so the official
 *    site outranks listicles and same-name clinics elsewhere.
 *  Direct results carry `via: "user-url"`; confirmTarget auto-confirms them. */
export async function run({ q, urls, prescraped, name, alias }, ctx = {}) {
  const signal = ctx.signal;
  const report = ctx.report ?? (() => {});
  const explicitUrls = (Array.isArray(urls) && urls.length > 0 ? urls : extractUrls(q)).slice(0, 2);
  const prescrapedPages = (Array.isArray(prescraped) ? prescraped : []).filter(
    (p) => p && p.url && typeof p.markdown === "string" && p.markdown,
  );
  const alreadyHave = new Set(prescrapedPages.map((p) => p.url));
  const toFetch = explicitUrls.filter((u) => !alreadyHave.has(u));

  const results = [];
  let lastError = undefined;

  // Pages fetched earlier in this run ARE what the user pointed at — reuse
  // them verbatim, no second Firecrawl round-trip.
  for (const page of prescrapedPages) {
    const { title, snippet } = describeMarkdown(page.markdown);
    results.push({ title, url: page.url, snippet, via: "user-url" });
  }

  // Direct scrapes next — they ARE what the user pointed at.
  for (const url of toFetch) {
    try {
      report({ detail: url });
      const { markdown } = await scrapePage({ url }, { signal, report });
      const { title, snippet } = describeMarkdown(markdown);
      results.push({ title, url, snippet, via: "user-url" });
    } catch (err) {
      lastError = err;
    }
  }

  if (config.search.searxngUrl && searchQuery(q).length >= 2) {
    try {
      report({ detail: searchQuery(q) });
      const searchUrl = new URL(`${config.search.searxngUrl}/search`);
      searchUrl.searchParams.set("q", searchQuery(q));
      searchUrl.searchParams.set("format", "json");
      searchUrl.searchParams.set("safesearch", "0");
      // Geo-scoping (Phase 0 spike): a bare office name otherwise surfaces
      // wrong-country businesses. ja-JP biases results to Japan; callers append
      // location terms for the specific prefecture/city.
      searchUrl.searchParams.set("language", config.search.language);

      const res = await fetch(searchUrl, { signal });
      if (!res.ok) {
        throw Object.assign(new Error(`SearXNG search failed: ${res.status}`), { status: 502 });
      }
      const json = await res.json();
      // Fetch extra headroom — the official site often sits below aggregator
      // pages in raw order; the name-aware rerank needs it in the pool.
      const hits = (json.results ?? [])
        .filter((r) => r && r.url)
        .slice(0, 10)
        .map((r) => ({ title: r.title ?? "", url: r.url, snippet: r.content ?? "", via: "search" }));
      // Direct scrapes stay on top regardless — they ARE what the user
      // pointed at; only search hits compete among themselves.
      const ranked = rankResults(hits, name, alias).slice(0, 6);
      results.push(...ranked);
    } catch (err) {
      lastError = err;
    }
  }

  if (results.length === 0) {
    throw (
      lastError ??
      Object.assign(
        new Error(
          "Search is not configured. Set SEARXNG_URL (and FIRECRAWL_URL) in .env — see SETUP.md.",
        ),
        { status: 501 },
      )
    );
  }
  return { query: q, results };
}

export const step = {
  lane: "net",
  attemptMs: 60_000,
  label: (input) => `Searching the web for "${input?.q ?? ""}"…`,
  run,
};
