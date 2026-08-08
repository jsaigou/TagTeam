import express from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// ── Config ──────────────────────────────────────────────────

const PORT = process.env.PORT || 8083;
const PERXONA_API_BASE_URL = process.env.PERXONA_API_BASE_URL;
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
  route(async (_req, res) => {
    res.json(await authedCall((token) => connectApi.voices(token)));
  }),
);

app.get(
  "/api/avatars",
  route(async (_req, res) => {
    res.json(await authedCall((token) => connectApi.avatars(token)));
  }),
);

app.get(
  "/api/scenes",
  route(async (_req, res) => {
    res.json(await authedCall((token) => connectApi.scenes(token)));
  }),
);

// Static frontend (production build). Dev uses Vite with a /api proxy.
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(DIST_DIR, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`\nTagTeam`);
  console.log(`  URL  : http://localhost:${PORT}`);
  connectApi.checkUpstream().then((status) => {
    console.log(`  API  : ${status}  ${PERXONA_API_BASE_URL}`);
  });
});
