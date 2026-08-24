/**
 * Phase 7b job step — SearXNG web search. Lifted from the body of the old
 * `GET /api/search` handler in server.mjs (Phase 2). Runs in the "net" lane.
 *
 * Objective-embedded URLs: if the user's message contains a link (e.g. they
 * paste a ward-office page as their whole task), those pages are scraped
 * DIRECTLY via the scrape step and become top candidates — a raw URL string
 * is a poor SearXNG query. Search still runs on the remaining text; with no
 * SearXNG configured, scraped links alone are enough to keep the run alive.
 */
import { config } from "../providers.mjs";
import { run as scrapePage } from "./scrape.mjs";

const URL_IN_TEXT = /https?:\/\/[^\s)]+/gi;

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

/** Score one result against the normalized target name. Higher is better. */
export function scoreResult(result, normalizedName) {
  const hay = normText(`${result.title} ${result.url}`);
  let score = 0;
  if (!normalizedName) {
    // No name to match against — only demote obvious directories/listicles.
    return -AGGREGATOR_PATTERNS.reduce(
      (n, p) => n + (p.test(hay) ? 1 : 0),
      0,
    );
  }
  // Exact normalized-name containment is the strong signal ("目白台歯科",
  // "mejirodaidental.jp" folds to contain "mejirodaidentalclinic"-ish runs).
  if (hay.includes(normalizedName)) {
    score += 6;
  } else {
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
    // Latin word overlap covers romanized URLs (mejirodai + dental + clinic).
    const words = normalizedName.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
    if (words.length > 0) {
      const hit = words.filter((w) => hay.includes(w)).length;
      score += 3 * (hit / words.length);
    }
  }
  // Directory/listicle pages are almost never the place itself.
  const aggHits = AGGREGATOR_PATTERNS.filter((p) => p.test(hay)).length;
  score -= Math.min(aggHits * 4, 8);
  return score;
}

/** Stable-sorted copy, best first. Results keep their relative order on ties. */
export function rankResults(results, name) {
  const normalizedName = normText(name);
  return results
    .map((r, i) => ({ r, i, score: scoreResult(r, normalizedName) }))
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

/** @param {{ q: string, name?: string }} input — `name` is the identified
 *  target (server/steps/identifyTarget.mjs); search hits are reranked
 *  against it so the official site outranks listicles and same-name
 *  clinics elsewhere. */
export async function run({ q, name }, { signal, report }) {
  const urls = [...new Set(q.match(URL_IN_TEXT) ?? [])].slice(0, 2);
  // Strip links for the search query — a URL is noise to SearXNG.
  const queryText = q.replace(URL_IN_TEXT, "").replace(/\s+/g, " ").trim() || q;

  const results = [];
  let lastError = undefined;

  // Direct scrapes first — they ARE what the user pointed at.
  for (const url of urls) {
    try {
      report({ detail: url });
      const { markdown } = await scrapePage({ url }, { signal, report });
      const { title, snippet } = describeMarkdown(markdown);
      results.push({ title, url, snippet });
    } catch (err) {
      lastError = err;
    }
  }

  if (config.search.searxngUrl && queryText.length >= 2) {
    try {
      report({ detail: queryText });
      const searchUrl = new URL(`${config.search.searxngUrl}/search`);
      searchUrl.searchParams.set("q", queryText);
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
        .map((r) => ({ title: r.title ?? "", url: r.url, snippet: r.content ?? "" }));
      // Direct scrapes stay on top regardless — they ARE what the user
      // pointed at; only search hits compete among themselves.
      const ranked = rankResults(hits, name).slice(0, 6);
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
