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

/** @param {{ q: string }} input */
export async function run({ q }, { signal, report }) {
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
      for (const r of (json.results ?? [])
        .filter((r) => r && r.url)
        .slice(0, 5)) {
        results.push({ title: r.title ?? "", url: r.url, snippet: r.content ?? "" });
      }
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
