/** Reference search — used to research the office/agency the user will call. */
import express from "express";
import crypto from "node:crypto";
import { requireAuth } from "../middleware.mjs";

/** @param {{ config: object, jobRunner: object }} deps */
export function createSearchRoutes({ config, jobRunner }) {
  const router = express.Router();

  // Runs research (SearXNG) then scrapes the top results (Firecrawl) through
  // the job runner; still returns a Server-Sent-Events stream so the caller
  // sees hits and scraped pages as they arrive, instead of waiting for
  // everything — this route is a thin SSE wrapper over background jobs now,
  // not where the work happens (Phase 7 plan §7b.5 migration step 1):
  //   event: hits  → the SearXNG results list (fast)
  //   event: page  → each scraped page as it completes
  //   event: done  → the assembled digest (grounding text for the simulation)
  //
  // Integrators must point SEARXNG_URL (and optionally FIRECRAWL_URL) at
  // their own instances — see SETUP.md. If search is not configured, the
  // feature is unavailable and returns a clear error rather than silently
  // failing.
  router.get("/api/search", requireAuth, async (req, res) => {
    const q = String(req.query.q ?? "").trim();
    if (!q) {
      res.status(400).json({ error: "Missing q parameter" });
      return;
    }
    if (!config.search.searxngUrl) {
      res.status(501).json({
        error: "Search is not configured. Set SEARXNG_URL (and FIRECRAWL_URL) in .env — see SETUP.md.",
      });
      return;
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    res.flushHeaders?.();

    /** Emit one SSE event with the given name + JSON data. */
    const emit = (name, data) => {
      res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Request-scoped run key — this route has no app_session, so jobs here
    // are one-shot; clearRun() below drops them immediately rather than
    // waiting on a TTL sweep meant for long-lived session-scoped runs.
    const runKey = crypto.randomUUID();

    try {
      const { results } = await jobRunner.enqueue(runKey, "research", { q }).settled;
      emit("hits", { query: q, results });

      const scraped = [];
      if (config.scrape.firecrawlUrl) {
        const targets = results.slice(0, 2);
        const outcomes = await Promise.allSettled(
          targets.map((r) => jobRunner.enqueue(runKey, "scrape", { url: r.url }).settled),
        );
        for (const outcome of outcomes) {
          if (outcome.status !== "fulfilled") continue; // skip un-scrapable pages
          scraped.push(outcome.value);
          emit("page", { url: outcome.value.url, index: scraped.length, total: targets.length });
        }
      }

      const digest = [
        `【検索: ${q}】`,
        ...results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${(r.snippet ?? "").slice(0, 300)}`),
        "",
        ...scraped.map((s, i) => `【ページ ${i + 1}: ${s.url}】\n${s.markdown}`),
        ...(config.scrape.firecrawlUrl ? [] : ["\n(no page scraping configured — set FIRECRAWL_URL to include page content)"]),
      ].join("\n\n");

      emit("done", { query: q, results, digest: digest.slice(0, 20_000) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit("error", { error: message });
    } finally {
      jobRunner.clearRun(runKey);
      res.end();
    }
  });

  return router;
}
