# TagTeam — Repository Guidelines

**TagTeam** is an AI-powered voice simulator and live co-pilot for non-native residents navigating
Japanese bureaucracy phone calls, built on the Perxona Connect Kit (`<sv-presenter>` Web Component)
and an OpenAI-compatible LLM.

> **Read `docs/architecture.md` first** — it is the authoritative design doc (provider layer,
> target-specific geo-scoped research, three device modes, roadmap). `docs/phase0-spike.md`
> records what was verified live against Perxona. `CONTRACT.md` is the stale hackday doc and is
> being superseded.

## Current status (Phase 1 + 2)

Done: presenter layer at the full 0.2.0 surface; canned demo removed; **better-auth + Drizzle +
SQLite login gate**; provider module (`server/providers.mjs`); Dockerfile + docker-compose;
**Phase 2 — multi-device + scanning**: WebSocket session hub (`server/hub.mjs`, `/api/ws`) +
`app_session`/upload REST, desktop QR pairing panel, phone companion route (`/phone`) with
Hold/Resume + page scanning, OpenCV.js edge-detect/crop (`src/lib/scan.ts`), multi-page document
bundles (`DocInput.kind: "images"`).
Next: **Phase 3 — real conversation** (`/api/stt` whisper.cpp, push-to-talk, `nextTurn` adaptive
brain, `audio` hub message, companion mic). The `audio` WS message is deliberately not implemented
yet. Companion tap-help has no phone-side vocab picker yet.

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
- **Client-side (`VITE_` prefix, exposed to the browser):** `VITE_PRESENTER_URL`,
  `VITE_LLM_MODEL`, optional `VITE_OPENCV_URL` (document scan engine; default docs.opencv.org).

## Architecture

- **User login via better-auth** (`server/auth.mjs`). `server.mjs` (Express) holds the shared
  Connect identity from env, mints a connect_token for the browser (`GET /api/connect-token`),
  and proxies the catalog (`GET /api/avatars|scenes|voices`). Vite proxies `/api` → `:8083` in
  dev; in prod the server serves the built app. Modeled on the perxona-connect-kit
  `samples/express` server.
- **Multi-device sessions** (`server/hub.mjs` + `src/state/session-context.tsx`): the desktop is
  the `stage` device; phones join `/phone#s=<id>&p=<code>` as `input`+`control`. Session REST
  (`POST /api/sessions`, uploads) + WS hub at `/api/ws` (Vite proxy upgrades it with `ws:true`).
  Shared protocol types are in `src/shared/contract.ts`; pure join/status helpers in
  `src/lib/session-utils.ts`. Uploaded pages are ephemeral (10-min TTL) and deleted on ack.
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
