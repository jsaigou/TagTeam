import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { and, desc, eq, gt } from "drizzle-orm";

import { auth } from "./server/auth.mjs";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { config, llmChat, synthesizeSpeech, transcribeAudio } from "./server/providers.mjs";
import { createCallOrchestrator } from "./server/orchestrator.mjs";
import { NEXT_TURN_SCHEMA_TEXT } from "./server/next-turn.mjs";
import { createJobRunner } from "./server/jobs.mjs";
import { createRunEngine } from "./server/graph.mjs";
import { classifyIntent } from "./server/intent.mjs";
import { step as researchStep } from "./server/steps/research.mjs";
import { step as scrapeStep } from "./server/steps/scrape.mjs";
import { step as identifyTargetStep } from "./server/steps/identifyTarget.mjs";
import { step as geolocateStep } from "./server/steps/geolocate.mjs";
import { step as extractTargetRulesStep } from "./server/steps/extractTargetRules.mjs";
import { step as planScenarioStep } from "./server/steps/planScenario.mjs";
import { createParseDocumentStep } from "./server/steps/parseDocument.mjs";
import {
  createScenario,
  deleteScenario,
  getScenario,
  listScenarios,
  updateScenario,
} from "./server/scenarios.mjs";
import { db, schema } from "./server/db.mjs";
import {
  attachHub,
  createUploadStore,
  generatePairingCode,
  PAIRING_TTL_MS,
} from "./server/hub.mjs";

// ── Config ──────────────────────────────────────────────────

const PORT = process.env.PORT || 8083;
const PERXONA_API_BASE_URL = (process.env.PERXONA_API_BASE_URL || "").replace(/\/+$/, "");
const CONNECT_EMAIL = process.env.PERXONA_CONNECT_EMAIL;
const CONNECT_PASSWORD = process.env.PERXONA_CONNECT_PASSWORD;
const PRESENTER_URL =
  process.env.PRESENTER_URL ||
  "https://cdn.perxona.ai/asia/prod/latest/widget/entry/presenter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, "dist");

if (!PERXONA_API_BASE_URL || !CONNECT_EMAIL || !CONNECT_PASSWORD) {
  console.error(
    "ERROR: PERXONA_API_BASE_URL, PERXONA_CONNECT_EMAIL and PERXONA_CONNECT_PASSWORD are required.\n" +
      "Copy .env.example to .env and fill them in with your Perxona service credentials.",
  );
  process.exit(1);
}

if (!process.env.BETTER_AUTH_SECRET) {
  console.error(
    "ERROR: BETTER_AUTH_SECRET is required.\n" +
      "Add a random secret to .env, e.g. BETTER_AUTH_SECRET=$(openssl rand -hex 32).",
  );
  process.exit(1);
}

// ── Upstream API ────────────────────────────────────────────

async function callUpstream(upstreamPath, opts = {}, token) {
  // Every upstream call gets a deadline — a hung Connect call used to hang
  // forever (worst offender: the connect-chatbot nextTurn brain, which had no
  // signal at all and could wedge a session's audio pipeline indefinitely).
  // An external `signal` (e.g. the orchestrator's overall retry-loop
  // deadline) can additionally cut it short, but never extend it.
  const { timeoutMs = 20_000, headers: optHeaders, signal: externalSignal, ...rest } = opts;
  const headers = { "Content-Type": "application/json", ...optHeaders };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const attemptCap = AbortSignal.timeout(timeoutMs);
  return fetch(`${PERXONA_API_BASE_URL}${upstreamPath}`, {
    ...rest,
    headers,
    signal: externalSignal ? AbortSignal.any([attemptCap, externalSignal]) : attemptCap,
  });
}

async function upstreamJson(res, label) {
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`upstream ${label} failed`), {
      status: res.status,
      payload,
    });
  }
  return res.json();
}

const connectApi = {
  async login(body) {
    const res = await callUpstream("/api/v1/connect/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return upstreamJson(res, "login");
  },

  async voices(token) {
    const res = await callUpstream("/api/v1/connect/voices", {}, token);
    return upstreamJson(res, "voices");
  },

  async avatars(token) {
    const res = await callUpstream("/api/v1/connect/assets/avatars", {}, token);
    const page = await upstreamJson(res, "avatars");
    return {
      ...page,
      items: (page.items ?? []).map(({ avatar_id, ...rest }) => ({
        id: avatar_id,
        ...rest,
      })),
    };
  },

  async motions(token, avatarId) {
    const res = await callUpstream(
      `/api/v1/connect/assets/avatars/${encodeURIComponent(avatarId)}/motions?size=100`,
      {},
      token,
    );
    const page = await upstreamJson(res, "motions");
    return {
      ...page,
      items: (page.items ?? []).map(({ motion_id, ...rest }) => ({
        id: motion_id,
        ...rest,
      })),
    };
  },

  /** One stateless Connect Chatbot turn (Phase 5d — nextTurn backend). The
   *  persona lives in the chatbot's custom_instructions; the caller's full
   *  context is sent as a single user message. Returns the reply text. */
  async chatbotChat(token, chatbotId, content, { signal } = {}) {
    const res = await callUpstream(
      `/api/v1/connect/chatbots/${encodeURIComponent(chatbotId)}/chat`,
      {
        method: "POST",
        body: JSON.stringify({
          messages: [{ role: "user", parts: [{ type: "text", text: content }] }],
        }),
        // Same budget as the own-LLM nextTurn path (providers.mjs llmChat) —
        // this is the alternative brain and can legitimately reason as long.
        timeoutMs: 120_000,
        signal,
      },
      token,
    );
    const payload = await upstreamJson(res, "chatbot chat");
    if (payload.status === "failed" || typeof payload.reply_text !== "string") {
      throw Object.assign(new Error("The chatbot did not produce a reply."), { status: 502 });
    }
    return payload.reply_text;
  },

  async scenes(token) {
    const res = await callUpstream("/api/v1/connect/assets/scenes", {}, token);
    const page = await upstreamJson(res, "scenes");
    return {
      ...page,
      items: (page.items ?? []).map(({ scene_id, ...rest }) => ({
        id: scene_id,
        ...rest,
      })),
    };
  },

  async checkUpstream() {
    try {
      const res = await fetch(`${PERXONA_API_BASE_URL}/ready`);
      return res.ok ? "reachable" : "unreachable";
    } catch {
      return "unreachable";
    }
  },
};

// ── Shared token manager ────────────────────────────────────
// ONE Connect identity (from env) shared by every visitor — no per-user login.

let cachedToken = null;
let loginPromise = null;

async function getToken({ forceRefresh = false } = {}) {
  if (cachedToken && !forceRefresh) return cachedToken;
  if (forceRefresh) cachedToken = null;
  if (!loginPromise) {
    loginPromise = connectApi
      .login({ email: CONNECT_EMAIL, password: CONNECT_PASSWORD })
      .then(({ access_token }) => {
        cachedToken = access_token;
        return cachedToken;
      })
      .finally(() => {
        loginPromise = null;
      });
  }
  return loginPromise;
}

async function authedCall(fn) {
  const token = await getToken();
  try {
    return await fn(token);
  } catch (err) {
    if (err.status !== 401 && err.status !== 403) throw err;
    const freshToken = await getToken({ forceRefresh: true });
    return fn(freshToken);
  }
}

// ── Express app ─────────────────────────────────────────────

const app = express();
app.disable("x-powered-by");
// Behind a TLS-terminating reverse proxy (docktail), `req.protocol`/`req.hostname`
// only reflect the external scheme/host when forwarded headers are trusted.
app.set("trust proxy", true);

// ── Auth (better-auth) ─────────────────────────────────────────────────────

// Mounted BEFORE express.json() so toNodeHandler can read the raw body stream.
const authHandler = toNodeHandler(auth);
app.all("/api/auth/*splat", async (req, res) => {
  try {
    await authHandler(req, res);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Global JSON body parser. The limit MUST sit above the largest route-level
// intent (/api/stt and /api/audio accept 15 MB of base64 WAV — real spoken
// utterances are typically 0.3–2 MB): with the express default (100 KB) the
// global parser 413s long before a route's own bigger parser runs, which is
// exactly what silently killed push-to-talk STT in production for weeks
// (short dev clips squeaked under 100 KB; real sentences never do).
app.use(express.json({ limit: "25mb" }));

/** Express middleware: require a valid session, else 401. Attaches req.user. */
async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = session.user;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status ?? 502;
      res.status(status).json(err.payload ?? { error: String(err) });
    }
  };
}

app.get("/api/health", async (_req, res) => {
  res.json({ status: "ok", upstream: await connectApi.checkUpstream() });
});

app.get("/api/config", (_req, res) => {
  res.json({ presenterUrl: PRESENTER_URL });
});

// Mints the Connect Kit bearer token for the browser. <sv-presenter> then talks
// to the Connect API directly with it — this server only ever holds the real
// credentials (env) and never ships them to the browser.
app.get(
  "/api/connect-token",
  requireAuth,
  route(async (_req, res) => {
    res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
    const connectToken = await authedCall(async (token) => {
      await connectApi.voices(token);
      return token;
    });
    res.json({ connect_token: connectToken });
  }),
);

app.get(
  "/api/voices",
  requireAuth,
  route(async (_req, res) => {
    res.json(await authedCall((token) => connectApi.voices(token)));
  }),
);

app.get(
  "/api/avatars",
  requireAuth,
  route(async (_req, res) => {
    res.json(await authedCall((token) => connectApi.avatars(token)));
  }),
);

// Motion catalog for one avatar (Phase 4 motion browser). Motions are
// per-avatar — never reuse guide motions on practice avatars.
app.get(
  "/api/avatars/:avatarId/motions",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 30 }),
  route(async (req, res) => {
    const { avatarId } = req.params;
    if (typeof avatarId !== "string" || !avatarId) {
      res.status(400).json({ error: "Missing avatar id." });
      return;
    }
    res.json(await authedCall((token) => connectApi.motions(token, avatarId)));
  }),
);

app.get(
  "/api/scenes",
  requireAuth,
  route(async (_req, res) => {
    res.json(await authedCall((token) => connectApi.scenes(token)));
  }),
);

// ── Demo sandbox API (dev only) ─────────────────────────────────────────────
// The avatar-effects demo (`/demo` in dev, separate Vite entry) has no login
// screen, so it needs an unauthenticated token mint + catalog. Registered only
// when NOT in production (the Docker runtime sets NODE_ENV=production) or when
// explicitly opted in with ENABLE_DEMO_API=1. The minted token is the same
// shared Connect identity the authed endpoints use — never per-user secrets.
const DEMO_API_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_API === "1";

if (DEMO_API_ENABLED) {
  app.get(
    "/api/demo/connect-token",
    rateLimit({ windowMs: 60_000, max: 30 }),
    route(async (_req, res) => {
      res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
      const connectToken = await authedCall(async (token) => {
        await connectApi.voices(token);
        return token;
      });
      res.json({ connect_token: connectToken });
    }),
  );

  app.get(
    "/api/demo/avatars",
    rateLimit({ windowMs: 60_000, max: 30 }),
    route(async (_req, res) => {
      res.json(await authedCall((token) => connectApi.avatars(token)));
    }),
  );

  app.get(
    "/api/demo/scenes",
    rateLimit({ windowMs: 60_000, max: 30 }),
    route(async (_req, res) => {
      res.json(await authedCall((token) => connectApi.scenes(token)));
    }),
  );

  app.get(
    "/api/demo/voices",
    rateLimit({ windowMs: 60_000, max: 30 }),
    route(async (_req, res) => {
      res.json(await authedCall((token) => connectApi.voices(token)));
    }),
  );

  app.get(
    "/api/demo/avatars/:avatarId/motions",
    rateLimit({ windowMs: 60_000, max: 30 }),
    route(async (req, res) => {
      const { avatarId } = req.params;
      if (typeof avatarId !== "string" || !avatarId) {
        res.status(400).json({ error: "Missing avatar id." });
        return;
      }
      res.json(await authedCall((token) => connectApi.motions(token, avatarId)));
    }),
  );
}

// Phase 7b — ephemeral upload store, hoisted ABOVE the job runner: the
// parseDocument step reads uploaded document bytes by uploadId, so the runner
// and the WS hub must share ONE store. attachHub below is handed this same
// instance (it starts the TTL sweeper itself), keeping the existing
// companion-photo-handoff routes and the job step on one store.
const uploadStore = createUploadStore();

// Phase 7b — background job runner. Steps are plain modules (server/steps/*)
// run by the generic runner in server/jobs.mjs; the "net" lane fans research
// + scrape out concurrently instead of the old strictly-sequential loop, and
// the "llm" lane (reserved for later migration slices — see the Phase 7 plan
// §7b) caps at LLM_CONCURRENCY since the deployed model serializes anyway.
const jobRunner = createJobRunner({
  steps: {
    research: researchStep,
    scrape: scrapeStep,
    identifyTarget: identifyTargetStep,
    geolocate: geolocateStep,
    extractTargetRules: extractTargetRulesStep,
    planScenario: planScenarioStep,
    // A factory, unlike the pure env-singleton steps above: it needs the
    // shared upload store injected (see server/steps/parseDocument.mjs).
    parseDocument: createParseDocumentStep({ uploadStore }).step,
  },
  lanes: {
    net: { concurrency: 3 },
    llm: { concurrency: Number(process.env.LLM_CONCURRENCY) || 1 },
  },
});

// Phase 7b §7b.3 — the confirmTarget gate. Sits on top of the same jobRunner
// (shared lanes/concurrency with the flat /api/search usage above) and adds
// dependency resolution + the user-confirm pause. See server/graph.mjs.
const runEngine = createRunEngine({ jobRunner });

// Reference search — used to research the office/agency the user will call.
// Runs research (SearXNG) then scrapes the top results (Firecrawl) through
// the job runner above; still returns a Server-Sent-Events stream so the
// caller sees hits and scraped pages as they arrive, instead of waiting for
// everything — this route is a thin SSE wrapper over background jobs now,
// not where the work happens (Phase 7 plan §7b.5 migration step 1):
//   event: hits  → the SearXNG results list (fast)
//   event: page  → each scraped page as it completes
//   event: done  → the assembled digest (grounding text for the simulation)
//
// Integrators must point SEARXNG_URL (and optionally FIRECRAWL_URL) at their own
// instances — see SETUP.md. If search is not configured, the feature is
// unavailable and returns a clear error rather than silently failing.
app.get(
  "/api/search",
  requireAuth,
  async (req, res) => {
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
  },
);

// LLM proxy — the browser posts OpenAI-compatible chat completions here
// (same-origin, no CORS); the key/base URL stay server-side.
app.post(
  "/api/llm",
  requireAuth,
  route(async (req, res) => {
    const { model, messages, temperature, response_format, max_tokens } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "Missing messages" });
      return;
    }
    try {
      const payload = await llmChat(messages, {
        model: typeof model === "string" && model ? model : undefined,
        temperature: typeof temperature === "number" ? temperature : 0.2,
        responseFormat: response_format,
        maxTokens: typeof max_tokens === "number" ? max_tokens : 8192,
      });
      res.json(payload);
    } catch (err) {
      res.status(err.status ?? 502).json(err.payload ?? { error: String(err) });
    }
  }),
);

// ── Rate limiting (API hardening, architecture §8) ─────────────────────────

/** Minimal fixed-window in-memory rate limiter keyed by user (or IP). */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs).unref?.();
  return (req, res, next) => {
    const key = req.user?.id ?? req.ip ?? "anonymous";
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ error: "Too many requests — please wait a moment and try again." });
      return;
    }
    next();
  };
}

// ── Speech-to-text (Phase 3) ───────────────────────────────────────────────

// The browser captures 16 kHz mono WAV (see src/lib/push-to-talk.ts) and POSTs
// it here as base64 JSON — the STT key/binary stay server-side. whisper.cpp is
// the default backend; STT_PROVIDER=hosted switches to an OpenAI-compatible
// `/audio/transcriptions` endpoint.
app.post(
  "/api/stt",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 20 }),
  express.json({ limit: "15mb" }),
  route(async (req, res) => {
    const { audio_base64, mime_type, language } = req.body ?? {};
    if (typeof audio_base64 !== "string" || !audio_base64) {
      res.status(400).json({ error: "'audio_base64' is required." });
      return;
    }
    const buffer = Buffer.from(audio_base64, "base64");
    if (buffer.length === 0) {
      res.status(400).json({ error: "Empty audio." });
      return;
    }
    const result = await transcribeAudio(buffer, {
      mimeType: typeof mime_type === "string" ? mime_type : "audio/wav",
      language: typeof language === "string" ? language : undefined,
    });
    res.json(result);
  }),
);

// BYO TTS (Phase 5f) — synthesize speech server-side (kokoro/qwen or any
// OpenAI-compatible /audio/speech) and return a 16 kHz mono WAV the avatar's
// presentWithAudio can play. Requires TTS_PROVIDER=byo.
app.post(
  "/api/tts",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 30 }),
  express.json({ limit: "1mb" }),
  route(async (req, res) => {
    const { text, language } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      res.status(400).json({ error: "'text' is required." });
      return;
    }
    const audio = await synthesizeSpeech(text, {
      language: typeof language === "string" ? language : undefined,
    });
    res.set({
      "Content-Type": "audio/wav",
      "Content-Length": audio.length,
      "Cache-Control": "no-store",
    });
    res.end(audio);
  }),
);

// Push-to-talk bytes go through the same ephemeral store as scanned pages: POST
// once, then announce the store reference over the WS hub (`audio` message).
app.post(
  "/api/audio",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 30 }),
  express.json({ limit: "15mb" }),
  route(async (req, res) => {
    const { audio_base64, mime_type, sessionId } = req.body ?? {};
    if (typeof audio_base64 !== "string" || !audio_base64) {
      res.status(400).json({ error: "'audio_base64' is required." });
      return;
    }
    const buffer = Buffer.from(audio_base64, "base64");
    if (buffer.length === 0) {
      res.status(400).json({ error: "Empty audio." });
      return;
    }
    const record = hub.uploadStore.create({
      filename: `audio-${Date.now()}.wav`,
      mimeType: typeof mime_type === "string" ? mime_type : "audio/wav",
      buffer,
      sessionId: typeof sessionId === "string" ? sessionId : undefined,
    });
    res.json(record);
  }),
);

// The stage seeds the scenario context once at call start; the orchestrator
// then runs `audio → stt → nextTurn` for any device in the session.
app.post(
  "/api/sessions/:id/call-context",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 10 }),
  express.json({ limit: "2mb" }),
  route(async (req, res) => {
    const row = await ownedSession(req, res);
    if (!row) return;
    const { script, glossary, summary, answers, reference, settings } = req.body ?? {};
    if (!script || !Array.isArray(script.turns) || !Array.isArray(glossary)) {
      res.status(400).json({ error: "'script' and 'glossary' are required." });
      return;
    }
    orchestrator.setContext(row.id, { script, glossary, summary, answers, reference, settings });
    res.json({ ok: true });
  }),
);

// ── Scenario persistence (Phase 5c) ────────────────────────────────────────
// Full call state (grounding + settings + script + glossary + cheat sheet)
// saved per user so a past call can be restored from the setup screen.
app.get(
  "/api/scenarios",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 30 }),
  route(async (req, res) => {
    res.json({ items: await listScenarios(req.user.id) });
  }),
);

app.post(
  "/api/scenarios",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 10 }),
  express.json({ limit: "2mb" }),
  route(async (req, res) => {
    const { script, glossary } = req.body ?? {};
    if (!script || !Array.isArray(script.turns) || !Array.isArray(glossary)) {
      res.status(400).json({ error: "'script' and 'glossary' are required." });
      return;
    }
    const { id } = await createScenario(req.user.id, req.body);
    res.status(201).json({ id });
  }),
);

app.get(
  "/api/scenarios/:id",
  requireAuth,
  route(async (req, res) => {
    const scenario = await getScenario(req.user.id, req.params.id);
    if (!scenario) {
      res.status(404).json({ error: "Scenario not found" });
      return;
    }
    res.json(scenario);
  }),
);

app.put(
  "/api/scenarios/:id",
  requireAuth,
  rateLimit({ windowMs: 60_000, max: 20 }),
  express.json({ limit: "2mb" }),
  route(async (req, res) => {
    const updated = await updateScenario(req.user.id, req.params.id, req.body ?? {});
    if (!updated) {
      res.status(404).json({ error: "Scenario not found" });
      return;
    }
    res.json(updated);
  }),
);

app.delete(
  "/api/scenarios/:id",
  requireAuth,
  route(async (req, res) => {
    const deleted = await deleteScenario(req.user.id, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: "Scenario not found" });
      return;
    }
    res.json({ ok: true });
  }),
);

// Static frontend (production build). Dev uses Vite with a /api proxy.
// index.html is served no-store: hashed asset filenames handle caching, and a
// stale shell referencing purged chunks is worse than one extra revalidation.
if (existsSync(DIST_DIR)) {
  app.use(
    express.static(DIST_DIR, {
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-store");
      },
    }),
  );
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

// ── Session hub (Phase 2) ──────────────────────────────────────────────────
// QR-able app sessions + ephemeral upload store. The pairing code is the
// bearer for the WS join; the phone can type it if it cannot scan.

function buildOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin.replace(/\/+$/, "");
  // No Origin header (e.g. same-origin GET) — derive from forwarded headers so
  // the QR join URL and hub wsUrl use https/wss behind a TLS-terminating proxy.
  const proto = String(req.protocol || "http").split(",")[0];
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0];
  return `${proto}://${host}`;
}

function toSessionSummary(row, req) {
  const origin = buildOrigin(req);
  return {
    id: row.id,
    status: row.status,
    pairingToken: row.pairingToken,
    pairingExpiresAt:
      row.pairingExpiresAt != null
        ? new Date(row.pairingExpiresAt).toISOString()
        : null,
    joinUrl: `${origin}/phone#s=${encodeURIComponent(row.id)}&p=${encodeURIComponent(row.pairingToken ?? "")}`,
    wsUrl: `${origin.replace(/^http/, "ws")}/api/ws`,
    deviceCount: hub.getDeviceCount(row.id),
  };
}

// Create an app session + fresh pairing code for the logged-in user.
app.post(
  "/api/sessions",
  requireAuth,
  route(async (req, res) => {
    const pairingExpiresAt = new Date(Date.now() + PAIRING_TTL_MS);
    const [row] = await db
      .insert(schema.appSession)
      .values({
        id: crypto.randomUUID(),
        userId: req.user.id,
        status: "active",
        pairingToken: generatePairingCode(),
        pairingExpiresAt,
        createdAt: new Date(),
      })
      .returning();
    res.json(toSessionSummary(row, req));
  }),
);

// The user's most recent active session (reconnect path for the desktop). A
// session whose pairing code has expired is NOT reusable — the desktop needs a
// live code to join the hub, so it must look like a 404 (creates a fresh one).
app.get(
  "/api/sessions/current",
  requireAuth,
  route(async (req, res) => {
    const [row] = await db
      .select()
      .from(schema.appSession)
      .where(
        and(
          eq(schema.appSession.userId, req.user.id),
          gt(schema.appSession.pairingExpiresAt, new Date()),
        ),
      )
      .orderBy(desc(schema.appSession.createdAt))
      .limit(1);
    if (!row || row.status !== "active") {
      res.status(404).json({ error: "No active session" });
      return;
    }
    res.json(toSessionSummary(row, req));
  }),
);

async function ownedSession(req, res) {
  const [row] = await db
    .select()
    .from(schema.appSession)
    .where(eq(schema.appSession.id, req.params.id))
    .limit(1);
  if (!row || row.userId !== req.user.id) {
    res.status(404).json({ error: "Session not found" });
    return null;
  }
  return row;
}

app.get(
  "/api/sessions/:id",
  requireAuth,
  route(async (req, res) => {
    const row = await ownedSession(req, res);
    if (!row) return;
    res.json(toSessionSummary(row, req));
  }),
);

// Rotate the pairing code (e.g. it was leaked, or the previous one expired).
app.post(
  "/api/sessions/:id/rotate-pairing",
  requireAuth,
  route(async (req, res) => {
    const row = await ownedSession(req, res);
    if (!row) return;
    const [updated] = await db
      .update(schema.appSession)
      .set({
        pairingToken: generatePairingCode(),
        pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS),
      })
      .where(eq(schema.appSession.id, row.id))
      .returning();
    res.json(toSessionSummary(updated, req));
  }),
);

// Ephemeral page upload (base64 JSON — no multipart dependency). The bytes
// live in the in-memory upload store for 10 minutes and are deleted on ack.
app.post(
  "/api/uploads",
  requireAuth,
  express.json({ limit: "12mb" }),
  route(async (req, res) => {
    const { filename, content_base64, mime_type } = req.body ?? {};
    if (!filename || !content_base64) {
      res.status(400).json({ error: "'filename' and 'content_base64' are required." });
      return;
    }
    if (filename.includes("/") || filename.includes("\\")) {
      res.status(400).json({ error: "Invalid filename." });
      return;
    }
    const buffer = Buffer.from(content_base64, "base64");
    if (buffer.length === 0) {
      res.status(400).json({ error: "Empty file." });
      return;
    }
    const record = hub.uploadStore.create({
      filename,
      mimeType: typeof mime_type === "string" ? mime_type : "image/jpeg",
      buffer,
      sessionId: typeof req.body.sessionId === "string" ? req.body.sessionId : undefined,
    });
    res.json(record);
  }),
);

app.get(
  "/api/uploads/:uploadId",
  requireAuth,
  route(async (req, res) => {
    const record = hub.uploadStore.get(req.params.uploadId);
    if (!record) {
      res.status(404).json({ error: "Upload not found or expired" });
      return;
    }
    res.set({
      "Content-Type": record.mimeType,
      "Content-Length": record.buffer.length,
      "Cache-Control": "no-store",
    });
    res.end(record.buffer);
  }),
);

app.delete(
  "/api/uploads/:uploadId",
  requireAuth,
  route(async (req, res) => {
    hub.uploadStore.remove(req.params.uploadId);
    res.status(204).end();
  }),
);

const server = http.createServer(app);

// ── nextTurn brain backend (Phase 5d) ──────────────────────────────────────
// Own-LLM by default; `NEXTTURN_PROVIDER=connect-chatbot` swaps the live
// brain for a Connect Chatbot. The chatbot's custom_instructions hold the
// persona; every per-call message (scenario context, coaching directives,
// transcript) is sent as one user message, with the nextTurn JSON schema
// appended so the reply parses like the own-LLM path.
const nextTurnChat =
  config.chatbot.nextTurnProvider === "connect-chatbot"
    ? async (messages, opts = {}) => {
        if (!config.chatbot.chatbotId) {
          throw Object.assign(
            new Error(
              "Connect Chatbot nextTurn is selected but CHATBOT_ID is unset — create a chatbot and set CHATBOT_ID in .env (see SETUP.md).",
            ),
            { status: 501 },
          );
        }
        const systemText = messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n");
        const userText = messages
          .filter((m) => m.role === "user")
          .map((m) => m.content)
          .join("\n");
        const content = [
          systemText,
          userText,
          opts.responseFormat ? `【出力】\n次のJSONスキーマに完全に従ったJSONオブジェクトのみを返してください。\n${NEXT_TURN_SCHEMA_TEXT}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        const reply = await authedCall((token) =>
          connectApi.chatbotChat(token, config.chatbot.chatbotId, content, { signal: opts.signal }),
        );
        return { choices: [{ message: { role: "assistant", content: reply } }] };
      }
    : llmChat;

const orchestrator = createCallOrchestrator({ transcribeAudio, llmChat: nextTurnChat });
const hub = attachHub(server, {
  db,
  schema,
  // The SAME store the parseDocument job step was built with above, so an
  // upload POSTed via /api/uploads is visible to the job (and ack/expiry
  // semantics stay identical for the companion-photo-handoff flow).
  uploadStore,
  orchestrator,
  runEngine,
  // Intent classification runs OUTSIDE the "llm" lane's own queueing (it's
  // meant to be near-instant) — see the Phase 7 plan §7b.1's open note on
  // reserving a lane slot vs. a smaller model. No LLM_INTENT_MODEL is wired
  // yet, so this currently rides the same serialized model as everything
  // else; that's an accepted latency trade-off for this slice, not a bug.
  classifyIntent: (text, opts) => classifyIntent(text, { ...opts, llmChat }),
});

server.listen(PORT, () => {
  console.log(`\nTagTeam`);
  console.log(`  URL  : http://localhost:${PORT}`);
  console.log(`  Hub  : ws://localhost:${PORT}/api/ws`);
  connectApi.checkUpstream().then((status) => {
    console.log(`  API  : ${status}  ${PERXONA_API_BASE_URL}`);
  });
});
