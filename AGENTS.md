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
- `VITE_` prefix required (Vite exposes them to the browser). LLM key is `VITE_LLM_API_KEY`.

## Architecture

- Auth is fully client-side against the Perxona Connect API (`POST /api/v1/connect/auth/login`);
  token in `sessionStorage`. Reference implementation:
  `tools/motion-browser/` in the perxona-connect-kit repo (`lib/auth.ts`, `hooks/use-auth.ts`,
  `lib/api.ts`, `hooks/use-catalog.ts`, `hooks/use-presenter.ts`, `hooks/use-avatar-session.ts`).
- `<sv-presenter>` runtime loads from the CDN `VITE_PRESENTER_URL`; `@perxona/presenter-types`
  is type-only. Presenter gotchas are in `CONTRACT.md` — read them before writing presenter code.
- Shared data shapes live in `src/shared/contract.ts` (coordinator-owned, import-only).

## Conventions

- TypeScript + React function components with hooks; Tailwind + shadcn/ui; keep it dependency-light.
- English UI copy; the avatar speaks Japanese (LLM-generated turns).
- Tests (`*.test.ts`) live next to the code under `src/` and run with Vitest.
- Never commit `.env` or real secrets (see `CONTRACT.md` secret hygiene).

## Getting Started

```bash
pnpm install
cp .env.example .env   # fill VITE_PERXONA_API_BASE_URL, VITE_LLM_API_KEY, ...
pnpm dev
```
