# TagTeam — Repository Guidelines

**TagTeam** is an AI-powered voice simulator and live co-pilot for non-native residents navigating
Japanese bureaucracy phone calls, built on the Perxona Connect Kit (`<sv-presenter>` Web Component)
and an OpenAI-compatible LLM.

## Stack

- **pnpm only** (`pnpm-lock.yaml` present). Do not mix npm.
- Vite 8 + React 19 + TypeScript + Tailwind CSS v4 + shadcn/ui (`components.json` present;
  `pnpm dlx shadcn@latest add <component>` to add primitives).
- Lint = `oxlint`, build = `tsc -b && vite build`, test = `vitest run`.
- Node >= 22 required.

## Environment

- `.env.example` is the only committed env file; copy to `.env` and fill in.
- **Server-side (server.mjs):** `PERXONA_API_BASE_URL`, `PERXONA_CONNECT_EMAIL`,
  `PERXONA_CONNECT_PASSWORD`, `PORT`. These hold the one shared Connect identity and never reach
  the browser.
- **Client-side (`VITE_` prefix, exposed to the browser):** `VITE_PRESENTER_URL`,
  `VITE_LLM_BASE_URL`, `VITE_LLM_API_KEY`, `VITE_LLM_MODEL`. LLM = the foundry a0 router
  (`https://a0.mango-rockhopper.ts.net/v1`, model `gemma4-mtp`).

## Architecture

- **No user login.** `server.mjs` (Express) holds the shared Connect identity from env, mints a
  connect_token for the browser (`GET /api/connect-token`), and proxies the catalog
  (`GET /api/avatars|scenes|voices`). Vite proxies `/api` → `:8083` in dev; in prod the server
  serves the built app. Modeled on the perxona-connect-kit `samples/express` server.
- `<sv-presenter>` runtime loads from the CDN `VITE_PRESENTER_URL`; `@perxona/presenter-types`
  is type-only. Presenter gotchas are in `CONTRACT.md` — read them before writing presenter code.
- Shared data shapes live in `src/shared/contract.ts` (coordinator-owned, import-only).
- `pnpm dev` runs api + web via concurrently; `pnpm start` serves the built app from `server.mjs`.

## Conventions

- TypeScript + React function components with hooks; Tailwind + shadcn/ui; keep it dependency-light.
- English UI copy; the avatar speaks Japanese (LLM-generated turns).
- Tests (`*.test.ts`) live next to the code under `src/` and run with Vitest.
- Never commit `.env` or real secrets (see `CONTRACT.md` secret hygiene).

## Getting Started

```bash
pnpm install
cp .env.example .env   # fill PERXONA_CONNECT_EMAIL/PASSWORD + VITE_LLM_API_KEY
pnpm dev               # api on :8083, web on :5173
```
