# TagTeam — Repository Guidelines

**TagTeam** is an AI-powered voice simulator and live co-pilot for non-native residents navigating
Japanese bureaucracy phone calls, built on the Perxona Connect Kit (`<sv-presenter>` Web Component)
and an OpenAI-compatible LLM.

> **Read `docs/architecture.md` first** — it is the authoritative design doc (provider layer,
> target-specific geo-scoped research, three device modes, roadmap). `docs/phase0-spike.md`
> records what was verified live against Perxona. `CONTRACT.md` is the stale hackday doc and is
> being superseded.

## Current status (Phase 1 + 2 + 3 + 4 + 5)

Done: presenter layer at the full 0.2.0 surface; canned demo removed; **better-auth + Drizzle +
SQLite login gate**; provider module (`server/providers.mjs`); Dockerfile + docker-compose;
**Phase 2 — multi-device + scanning**: WebSocket session hub (`server/hub.mjs`, `/api/ws`) +
`app_session`/upload REST, desktop QR pairing panel, phone companion route (`/phone`) with
Hold/Resume + page scanning, OpenCV.js edge-detect/crop (`src/lib/scan.ts`), multi-page document
bundles (`DocInput.kind: "images"`).
**Phase 3 — real conversation**: whisper.cpp STT provider + `/api/stt`; server orchestrator
(`server/orchestrator.mjs`) holding per-session scenario context + transcript; adaptive `nextTurn`
brain (`server/next-turn.mjs`); push-to-talk (PCM→16kHz WAV, `src/lib/audio-utils.ts` +
`src/hooks/use-push-to-talk.ts`) on desktop + phone companion; `audio`/`turn`/`phase` hub messages;
`setListening`/`setThinking` during the loop; `/api/audio` + `POST /api/sessions/:id/call-context`.
**Phase 4 — coaching + showcase**: coaching settings (roles / difficulty / pace) in the scenario
step, persona data in `src/shared/coaching.json` shared by client (`src/lib/coaching.ts`) and
server (`server/coaching.mjs`) and injected into BOTH sim generation and the live nextTurn brain;
emotion/intensity badges on active turns (sim schema now emits them); motion catalog browser
(`GET /api/avatars/:id/motions` proxy + `MotionBrowser` dialog with `playMotion` previews);
`CheatSheet.targetRules` (schema + validator + `Know before you call` section w/ citations);
Perxona branding badge.
**Phase 5 — companion + persistence**: in-app camera QR scanning ✓ (`CameraScanner` + jsQR,
lazy-loaded, on the phone companion); per-role avatar packs ✓ (curated avatar/scene/voice per role
in `coaching.json`, verified against the live catalog); scenario persistence ✓ (saved at call start
+ cheat-sheet attach, restored via `PastCalls` on the setup screen); Connect Chatbot as `nextTurn`
backend ✓ (`NEXTTURN_PROVIDER=connect-chatbot` + `CHATBOT_ID`, see SETUP.md §5c); phone-side vocab
picker ✓ (`AppSnapshot.activeVocab` drives companion Tap-help chips); BYO TTS ✓ (`TTS_PROVIDER=byo`
+ `VITE_TTS_PROVIDER=byo`, 16 kHz mono WAV via `presentWithAudio`, see SETUP.md §5d). See
`docs/architecture.md` §11 for the writeup.
Next: **Phase 6 — TBD** (candidate: target-specific grounding per §4/§5 — geolocate → scrape →
`extractTargetRules` with user confirmation, using the unused `scenario.target` column).

## Stack

- **pnpm only** (`pnpm-lock.yaml` present). Do not mix npm.
- Vite 8 + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui (`components.json` present;
  `pnpm dlx shadcn@latest add <component>` to add primitives).
- Lint = `oxlint`, build = `tsc -b && vite build`, test = `vitest run`.
- Node >= 22 required.

## Environment

- `.env.example` is the only committed env file; copy to `.env` and fill in.
- **Auth/db:** `BETTER_AUTH_SECRET` (required), optional `DATABASE_PATH` (default
  `./data/tagteam.db`), `BETTER_AUTH_URL`, `TRUSTED_ORIGINS`.
- **Server-side (server.mjs):** `PERXONA_API_BASE_URL`, `PERXONA_CONNECT_EMAIL`,
  `PERXONA_CONNECT_PASSWORD`, `PORT`. These hold the one shared Connect identity and never reach
  the browser.
- **LLM/search (server-side, `server/providers.mjs`):** `LLM_BASE_URL`, `LLM_API_KEY`,
  `LLM_MODEL`, optional `LLM_PROVIDER=openai|anthropic`; optional `SEARXNG_URL`, `FIRECRAWL_URL`,
  `FIRECRAWL_API_KEY`, `SEARCH_LANGUAGE` (default `ja-JP`).
- **Live brain (server-side):** `NEXTTURN_PROVIDER=own-llm|connect-chatbot` (default `own-llm`) +
  `CHATBOT_ID` (Connect Chatbot persona — see SETUP.md §5c).
- **STT (server-side, Phase 3):** `STT_PROVIDER=whisper-cpp|hosted` (default `whisper-cpp`),
  `WHISPER_BIN` (default `whisper-cli`), `WHISPER_MODEL` (default `ggml-base.bin`, resolved under
  `models/` or `data/models/` — whisper.cpp does NOT auto-download; see SETUP.md §5b), optional
  `STT_LANGUAGE` (default `ja`), and for `hosted`: `STT_BASE_URL`, `STT_API_KEY`, `STT_MODEL`.
- **TTS (server-side, Phase 5f):** `TTS_PROVIDER=perxona|byo` (default `perxona`), and for `byo`:
  `TTS_BASE_URL`, `TTS_API_KEY`, `TTS_MODEL`, optional `TTS_VOICE`/`TTS_LANGUAGE` (default `ja`) /
  `TTS_NORMALIZE` (default `1` — resample to 16 kHz mono WAV via ffmpeg; see SETUP.md §5d).
- **Client-side (`VITE_` prefix, exposed to the browser):** `VITE_PRESENTER_URL`,
  `VITE_LLM_MODEL`, optional `VITE_OPENCV_URL` (document scan engine; default docs.opencv.org),
  `VITE_TTS_PROVIDER=perxona|byo` (must mirror server `TTS_PROVIDER` for BYO speech).

**Known environment latency (do not "fix" without asking):** each push-to-talk spawns a fresh
`whisper-cli` subprocess (loads `ggml-base.bin` ~1s) and the configured homelab LLM
(`LLM_BASE_URL=https://a0.mango-rockhopper.ts.net/v1`, `gemma4-mtp`) reasons ~40–80s per call, so
the first reply of a call is slow by design. The `nextTurn` brain caps at 8192 tokens and retries
once on an empty/malformed reply (reasoning models burn the budget).

## Architecture

- **User login via better-auth** (`server/auth.mjs`). `server.mjs` (Express) holds the shared
  Connect identity from env, mints a connect_token for the browser (`GET /api/connect-token`),
  and proxies the catalog (`GET /api/avatars|scenes|voices` + `GET /api/avatars/:id/motions`).
  Vite proxies `/api` → `:8083` in dev; in prod the server serves the built app. Modeled on the
  perxona-connect-kit `samples/express` server.
- **Multi-device sessions** (`server/hub.mjs` + `src/state/session-context.tsx`): the desktop is
  the `stage` device; phones join `/phone#s=<id>&p=<code>` as `input`+`control` (in-app camera QR
  scan via `CameraScanner`, or type the code). Session REST (`POST /api/sessions`, uploads) + WS
  hub at `/api/ws` (Vite proxy upgrades it with `ws:true`). Shared protocol types are in
  `src/shared/contract.ts`; pure join/status helpers in `src/lib/session-utils.ts`. Uploaded pages
  are ephemeral (10-min TTL) and deleted on ack.
- **Real conversation (Phase 3)** — the **server orchestrator** (`server/orchestrator.mjs`) owns the
  per-session call context (`POST /api/sessions/:id/call-context` seeds script+glossary at call
  start) and the running transcript. Push-to-talk audio (16 kHz mono WAV, `src/lib/audio-utils.ts`
  + `src/hooks/use-push-to-talk.ts`) is POSTed to `/api/audio`, announced over the hub as
  `{ type: "audio", audioId }`, and the hub runs `audio → stt (whisper.cpp) → nextTurn
  (server/next-turn.mjs; `NEXTTURN_PROVIDER` = own-LLM default or Connect Chatbot) → broadcast
  turn/phase`. The stage presents broadcast bureaucrat turns with `setListening`/`setThinking`
  around the loop; the phone companion mic uses the same `audio` path. If STT/LLM are unconfigured
  the call falls back to scripted mode (Skip & continue).
- **Coaching (Phase 4)** — roles/difficulty/pace chosen in the scenario step; persona data in
  `src/shared/coaching.json` feeds both script generation (`src/lib/coaching.ts`) and the live
  brain (`server/coaching.mjs`). Settings persist per scenario row and ride the call context.
- **Persistence (Phase 5c)** — `server/scenarios.mjs` + `/api/scenarios`: full call state saved at
  call start, cheat sheet attached at finish, restored from `PastCalls` on the setup screen.
- **BYO TTS (Phase 5f)** — `TTS_PROVIDER=byo` + `VITE_TTS_PROVIDER=byo`: the avatar session's
  `present` synthesizes server-side (`POST /api/tts`) and plays via `presentWithAudio` (16 kHz mono
  WAV, ffmpeg-normalized), falling back to Perxona speech on failure.
- `<sv-presenter>` runtime loads from the CDN `VITE_PRESENTER_URL`; `@perxona/presenter-types`
  is type-only. Presenter gotchas are in `CONTRACT.md` — read them before writing presenter code.
- Shared data shapes live in `src/shared/contract.ts` (coordinator-owned, import-only).
- `pnpm dev` runs api + web via concurrently; `pnpm start` serves the built app from `server.mjs`.

## Star avatar

- The avatar is ALWAYS on screen (`AvatarStage`, fixed full-screen background) and guides the user
  through setup with speech bubbles (`AvatarGuide`) + spoken Japanese guidance. Default avatar is
  `cc051_meeks` (`src/lib/presets.ts`), launched from SetupScreen once the catalog loads.
- `resumeAudioPlayback` needs a trusted user gesture: the Get-started / Start-call click calls
  `unlockAudio()` (autoplay). Synthetic clicks (e.g. CDP) are NOT trusted gestures.
- Guide lines are `{ en }` — the bubble shows English (matches `GuideLine` in `avatar-context.tsx`).

## Conventions

- TypeScript + React function components with hooks; Tailwind + shadcn/ui; keep it dependency-light.
- English UI copy; the avatar speaks Japanese (LLM-generated turns).
- Tests (`*.test.ts`) live next to the code under `src/` and run with Vitest.
- Never commit `.env` or real secrets (see `CONTRACT.md` secret hygiene).

## Getting Started

```bash
pnpm install
cp .env.example .env   # fill BETTER_AUTH_SECRET, PERXONA_CONNECT_EMAIL/PASSWORD, LLM_API_KEY
pnpm dev               # api on :8083, web on :5173
```
