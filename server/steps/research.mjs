/**
 * Phase 7b job step — SearXNG web search. Lifted from the body of the old
 * `GET /api/search` handler in server.mjs (Phase 2). Runs in the "net" lane.
 */
import { config } from "../providers.mjs";

/** @param {{ q: string }} input */
export async function run({ q }, { signal, report }) {
  if (!config.search.searxngUrl) {
    throw Object.assign(
      new Error("Search is not configured. Set SEARXNG_URL (and FIRECRAWL_URL) in .env — see SETUP.md."),
      { status: 501 },
    );
  }
  report({ detail: q });

  const searchUrl = new URL(`${config.search.searxngUrl}/search`);
  searchUrl.searchParams.set("q", q);
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
  const results = (json.results ?? [])
    .filter((r) => r && r.url)
    .slice(0, 5)
    .map((r) => ({ title: r.title ?? "", url: r.url, snippet: r.content ?? "" }));
  return { query: q, results };
}

export const step = {
  lane: "net",
  attemptMs: 30_000,
  label: (input) => `Searching the web for "${input?.q ?? ""}"…`,
  run,
};
