import express from "express";
import http from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { auth } from "./server/auth.mjs";
import { toNodeHandler } from "better-auth/node";
import { config, llmChat, synthesizeSpeech, transcribeAudio } from "./server/providers.mjs";
import { createConnectClient } from "./server/connect-client.mjs";
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
import { step as classifyScenarioStep } from "./server/steps/classifyScenario.mjs";
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
import { createCatalogRoutes } from "./server/routes/catalog.mjs";
import { createMediaRoutes } from "./server/routes/media.mjs";
import { createSearchRoutes } from "./server/routes/search.mjs";
import { createSessionsRoutes } from "./server/routes/sessions.mjs";

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

// ── Upstream Connect API (ONE shared identity from env; never reaches the browser) ──

const { connectApi, authedCall } = createConnectClient({
  baseUrl: PERXONA_API_BASE_URL,
  email: CONNECT_EMAIL,
  password: CONNECT_PASSWORD,
});

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

// Phase 7b — ephemeral upload store, hoisted ABOVE the job runner: the
// parseDocument step reads uploaded document bytes by uploadId, so the runner
// and the WS hub must share ONE store.
const uploadStore = createUploadStore();

app.use(createCatalogRoutes({ connectApi, authedCall, presenterUrl: PRESENTER_URL }));
app.use(createMediaRoutes({ llmChat, transcribeAudio, synthesizeSpeech, uploadStore }));

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
    // Sprint 0 (Switchboard Plan) — registered but not yet a GRAPH node (see
    // server/steps/classifyScenario.mjs's header). Registering it here now
    // means Sprint 1 only has to add a graph entry, not wire the runner too.
    classifyScenario: classifyScenarioStep,
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

app.use(createSearchRoutes({ config, jobRunner }));

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

app.use(
  createSessionsRoutes({
    db,
    schema,
    uploadStore,
    orchestrator,
    getDeviceCount: hub.getDeviceCount,
    generatePairingCode,
    pairingTtlMs: PAIRING_TTL_MS,
    scenarios: { createScenario, getScenario, listScenarios, updateScenario, deleteScenario },
  }),
);

server.listen(PORT, () => {
  console.log(`\nTagTeam`);
  console.log(`  URL  : http://localhost:${PORT}`);
  console.log(`  Hub  : ws://localhost:${PORT}/api/ws`);
  connectApi.checkUpstream().then((status) => {
    console.log(`  API  : ${status}  ${PERXONA_API_BASE_URL}`);
  });
});
