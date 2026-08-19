/**
 * Phase 7b job step — Firecrawl page scrape. Lifted from the body of the old
 * `GET /api/search` handler in server.mjs (Phase 2), split into one job per
 * URL so the "net" lane can fan them out concurrently instead of the old
 * strictly-sequential `for` loop.
 */
import { config } from "../providers.mjs";

/** @param {{ url: string }} input */
export async function run({ url }, { signal, report }) {
  if (!config.scrape.firecrawlUrl) {
    throw Object.assign(new Error("Page scraping is not configured (FIRECRAWL_URL unset)."), {
      status: 501,
    });
  }
  report({ detail: url });

  const headers = { "Content-Type": "application/json" };
  if (config.scrape.firecrawlApiKey) headers.Authorization = `Bearer ${config.scrape.firecrawlApiKey}`;

  const res = await fetch(`${config.scrape.firecrawlUrl}/v1/scrape`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, formats: ["markdown"] }),
    signal,
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Firecrawl scrape failed (${res.status}): ${url}`), { status: 502 });
  }
  const json = await res.json();
  const markdown = json?.data?.markdown ?? "";
  if (!markdown) {
    throw Object.assign(new Error(`No content extracted: ${url}`), { status: 502 });
  }
  return { url, markdown: markdown.slice(0, 6000) };
}

export const step = {
  lane: "net",
  attemptMs: 40_000,
  label: (input) => `Reading ${input?.url ?? "a page"}…`,
  run,
};
