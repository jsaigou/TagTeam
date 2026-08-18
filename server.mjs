import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { eq, desc } from "drizzle-orm";

import { auth } from "./server/auth.mjs";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { config, llmChat } from "./server/providers.mjs";
import { db, schema } from "./server/db.mjs";
import {
  attachHub,
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

async function callUpstream(upstreamPath, opts, token) {
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${PERXONA_API_BASE_URL}${upstreamPath}`, { ...opts, headers });
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

app.use(express.json());

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

app.get(
  "/api/scenes",
  requireAuth,
  route(async (_req, res) => {
    res.json(await authedCall((token) => connectApi.scenes(token)));
  }),
);

// Reference search — used to research the office/agency the user will call.
// Searches via SearXNG (JSON API), then scrapes the top results with Firecrawl.
// Returns a text digest the LLM can ground the simulation in.
//
// Integrators must point SEARXNG_URL (and optionally FIRECRAWL_URL) at their own
// instances — see SETUP.md. If search is not configured, the feature is
// unavailable and returns a clear error rather than silently failing.
app.get(
  "/api/search",
  requireAuth,
  route(async (req, res) => {
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

    const searchUrl = new URL(`${config.search.searxngUrl}/search`);
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("format", "json");
    searchUrl.searchParams.set("safesearch", "0");
    // Geo-scoping (Phase 0 spike): a bare office name otherwise surfaces
    // wrong-country businesses. ja-JP biases results to Japan; callers append
    // location terms for the specific prefecture/city.
    searchUrl.searchParams.set("language", config.search.language);
    const sRes = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000) });
    if (!sRes.ok) {
      throw Object.assign(new Error(`SearXNG search failed: ${sRes.status}`), { status: 502 });
    }
    const sJson = await sRes.json();
    const results = (sJson.results ?? [])
      .filter((r) => r && r.url)
      .slice(0, 5)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url,
        snippet: r.content ?? "",
      }));

    const scraped = [];
    if (config.scrape.firecrawlUrl) {
      const fHeaders = { "Content-Type": "application/json" };
      if (config.scrape.firecrawlApiKey) fHeaders.Authorization = `Bearer ${config.scrape.firecrawlApiKey}`;
      for (const r of results.slice(0, 2)) {
        try {
          const fRes = await fetch(`${config.scrape.firecrawlUrl}/v1/scrape`, {
            method: "POST",
            headers: fHeaders,
            body: JSON.stringify({ url: r.url, formats: ["markdown"] }),
            signal: AbortSignal.timeout(25_000),
          });
          if (fRes.ok) {
            const fJson = await fRes.json();
            const md = fJson?.data?.markdown ?? "";
            if (md) scraped.push({ url: r.url, markdown: md.slice(0, 6000) });
          }
        } catch {
          /* skip un-scrapable pages */
        }
      }
    }

    const digest = [
      `【検索: ${q}】`,
      ...results.map((r, i) => `${i + 1}. ${r.title} — ${r.url}\n${(r.snippet ?? "").slice(0, 300)}`),
      "",
      ...scraped.map((s, i) => `【ページ ${i + 1}: ${s.url}】\n${s.markdown}`),
      ...(config.scrape.firecrawlUrl ? [] : ["\n(no page scraping configured — set FIRECRAWL_URL to include page content)"]),
    ].join("\n\n");

    res.json({ query: q, results, digest: digest.slice(0, 20_000) });
  }),
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

// Static frontend (production build). Dev uses Vite with a /api proxy.
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

// ── Session hub (Phase 2) ──────────────────────────────────────────────────
// QR-able app sessions + ephemeral upload store. The pairing code is the
// bearer for the WS join; the phone can type it if it cannot scan.

function buildOrigin(req) {
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) return origin.replace(/\/+$/, "");
  return `${req.protocol}://${req.headers.host}`;
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

// The user's most recent active session (reconnect path for the desktop).
app.get(
  "/api/sessions/current",
  requireAuth,
  route(async (req, res) => {
    const [row] = await db
      .select()
      .from(schema.appSession)
      .where(eq(schema.appSession.userId, req.user.id))
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
const hub = attachHub(server, { db, schema });

server.listen(PORT, () => {
  console.log(`\nTagTeam`);
  console.log(`  URL  : http://localhost:${PORT}`);
  console.log(`  Hub  : ws://localhost:${PORT}/api/ws`);
  connectApi.checkUpstream().then((status) => {
    console.log(`  API  : ${status}  ${PERXONA_API_BASE_URL}`);
  });
});
