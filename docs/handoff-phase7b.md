# Handoff — TagTeam after Phase 7b (2026-08-21)

Brief for the next agent (Claude Code). Everything here was verified live on
2026-08-21; treat this as orientation, and the repo as source of truth.

## Read first

- `AGENTS.md` — stack, conventions, env vars, deployment. Authoritative for house rules.
- `docs/architecture.md` — design doc (§11 roadmap; §12 now records the resolved open questions).
- `SETUP.md` — env/provider setup. `CONTRACT.md` is stale hackday doc; ignore.

## Current state

- `origin/main` = `005961c`, deployed to Core at `https://tagteam.mango-rockhopper.ts.net`
  (health `{"status":"ok","upstream":"reachable"}`).
- Phase 7b (client→server migration) slices 1–6 are merged and deployed:
  background job runner (`server/jobs.mjs`: lanes, deadlines, input-hash dedup),
  step graph + run engine (`server/graph.mjs`), `confirmTarget` gate with
  speculative execution + confirm-the-guess dedup, `planScenario`/`parseDocument`
  as graph steps, and the intent-message UI (the `intent` WS message carries
  `RunContext` — doc/answers/settings/preset — into `startRun`; `deliver`
  selector stamps `run.result` onto every `RunSnapshot`; `RunStatus` UI).
- Verification baseline: 245/245 Vitest, `tsc -b && vite build` clean,
  `oxlint` 7 warnings / 0 errors (baseline — don't add new ones).
- Real-homelab smoke PASSED end-to-end (WS join → intent+context → classifyIntent
  → seeded run → research → gate → confirm-guess → planScenario → delivered
  result), and a local audible pass confirmed avatar speech through physical
  speakers via the prod build.

## Known next work

1. **`cheatSheet` as a graph step** — the last declared Phase 7b migration.
   `cheatSheet` exists in the `JobStep` union (`src/shared/contract.ts`) but has
   no node in `server/graph.mjs` (comment marks it: "later slices add them here,
   additively"). Migrate the client cheat-sheet generation
   (`src/lib/cheat-sheet.ts`) server-side, following the `planScenario`/
   `parseDocument` migration pattern; surface the result the way `planScenario`'s
   `deliver` selector does (or a new deliver step); mirror `src/lib/graph.test.ts`
   for tests.
2. **Event-day QA (not code):** audibility on the event phones (Mac pass done).
3. **Optional cleanup:** delete throwaway prod user
   `audio-smoke-20260821@example.invalid` (password `smoke-pass-7b`) from the
   better-auth DB if unwanted.

## Workflow rules (user-directed — follow these)

- Each slice in a **fresh git worktree**; fully verify before reporting:
  full Vitest suite, typecheck + production build, oxlint baseline, and a
  **real-homelab smoke** for anything LLM-facing (throwaway script at repo root,
  deleted afterwards with any copied `.env`).
- Leave work **UNCOMMITTED** for the user's review unless explicitly told to
  commit; never push or deploy without an explicit request.
- Commit style: `area: slice-name — gist` subject, body with rationale +
  verification evidence, `Co-Authored-By` trailer. See `git log` for examples.
- Deploy (only when asked):
  `git archive HEAD | tailscale ssh core 'cd /home/jon/docker/tagteam && tar -x'`
  then `tailscale ssh core 'cd /home/jon/docker/tagteam && docker compose up -d --build'`.

## Environment quirks (earned, not obvious)

- **pnpm only**; Node >= 22.
- Homelab LLM (`LLM_BASE_URL` on tailnet, model `gemma4-26b-a4b-nothink` — renamed from
  `gemma4-26b-a4b-nothink` on 2026-08-22; the thinking variant is `gemma4-26b-a4b`): 13–80 s per call;
  the run engine's `llm` lane concurrency is 1, so a full pipeline takes minutes.
  Size smoke timeouts/watchdogs accordingly. Prod STT is hosted; local default is
  whisper-cpp (needs the model under `models/`).
- `docs.opencv.org` sits behind Cloudflare bot protection — a bare HTTP fetch
  gets a challenge page. The scan engine is therefore **vendored** at
  `public/vendor/opencv.js` (official 4.10.0 build); don't point defaults back
  at the CDN.
- UI testing via the Orca CLI (`orca snapshot/fill/click/eval`): `fill` and
  `inserttext` do NOT update React controlled inputs — use `orca eval` with the
  native value setter + `input` event trick. `orca click` DOES count as a
  trusted user gesture (it unlocked the app's autoplay-gated audio).
- Shell sessions bound to one worktree reject `directory` outside it — use
  `git -C <abs>` / `pnpm --dir <abs> run <script>` for sibling checkouts.

## Code map for the cheatSheet slice

- `server/graph.mjs` — `GRAPH` definition, `deliver` selectors, `openGate`
  (gate snapshot broadcasts before speculative attach — a UI sees speculative
  jobs one snapshot late; deliberate, harmless).
- `server/jobs.mjs` — lanes/deadlines/dedup; `server/hub.mjs` — WS protocol
  (`intent`, `confirm`, `resolveGate`, `run` snapshots); `server/steps/*` —
  one file per step, mirror the shape.
- Shared types: `src/shared/contract.ts` (coordinator-owned, import-only).
- Tests live next to code: `src/lib/*.test.ts` (Vitest).
