# Handoff — security & code-quality hardening pass (2026-08-25)

Brief for the next agent (Claude Code or otherwise). Everything here was verified live on
2026-08-25; treat this as orientation, and the repo as source of truth.

## Read first

- `AGENTS.md` — stack, conventions, env vars, deployment. Authoritative for house rules. The
  Architecture section documents the `server.mjs` route-module split and the new hub/scrape/upload
  hardening described below — read it before touching `server/`.
- `docs/architecture.md` — design doc (§8 Security & privacy, §9 WS protocol, §11 roadmap — Phase
  7d is this pass).
- `docs/handoff-phase7b.md` — the previous handoff (client→server migration). Superseded for
  "current state" purposes by this doc, but its "Environment quirks" section still applies.
- `SETUP.md` — env/provider setup. `CONTRACT.md` is a stale hackday doc; ignore.

## Where this came from

A repo-wide code review (security anti-patterns, poorly organized functions, convoluted code) was
run across `server/` and `src/`, filed as 14 GitHub issues on `jsaigou/TagTeam` (#1-14: 8 security,
6 code-quality), then all 14 were fixed, verified, and closed in the same session. No new product
work — this is a hardening/cleanup pass on top of Phase 7c.

## Current state

- `origin/main` = `ae274d9`, deployed to Core at `https://tagteam.mango-rockhopper.ts.net`
  (verified `docker ps` shows `tagteam-api` up, container logs clean, `curl` returns `200`).
- Two commits, both pushed and deployed:
  - `4b7304d` — backend: WS hub hardening, SSRF guard, upload content check, scenario-update
    validation, `server.mjs` route-module split, shared rate-limiter.
  - `ae274d9` — frontend: `SetupScreen.tsx`/`CallScreen.tsx` extracted into hooks, candidate
    ref/state dedup, exhaustive-deps audit, upload size cap.
- Verification baseline: 305/305 Vitest, `tsc -b && vite build` clean, `oxlint` 8 warnings / 0
  errors (same pre-existing `only-export-components` warnings as before this pass — don't add new
  ones, and don't feel obligated to fix those 8, they're out of scope).
- A live browser smoke test (fresh sign-up, Get Started, chat send) hit zero console errors against
  the refactored `SetupScreen`.

## What changed (code map)

**Backend (`4b7304d`)**

| File | What it owns |
| --- | --- |
| `server/connect-client.mjs` | The Connect API client + shared token cache (`createConnectClient` → `{ connectApi, authedCall }`), lifted out of `server.mjs`. |
| `server/middleware.mjs` | `requireAuth`, `route` (async-handler error wrapper). Shared by every route module. |
| `server/rate-limit.mjs` | One shared fixed-window limiter registry + sweep interval, keyed by name. Both the HTTP `rateLimit(name, opts)` middleware and the WS hub's `consume(name, key, opts)` join-throttle build on this. |
| `server/ssrf-guard.mjs` | `assertPublicHttpUrl(url)` — throws on non-http(s) schemes or loopback/private/link-local hosts (incl. cloud metadata). Called from `server/steps/scrape.mjs`. |
| `server/file-sniff.mjs` | `isImageContent(buffer)` — magic-byte check (JPEG/PNG/GIF/WEBP/BMP/HEIC). Called from `POST /api/uploads` in `server/routes/sessions.mjs`. |
| `server/routes/catalog.mjs` | Connect catalog + the dev-only `/api/demo/*` mirror (logs a warning if enabled under `NODE_ENV=production`). |
| `server/routes/media.mjs` | `/api/llm`, `/api/stt`, `/api/tts`, `/api/audio`. |
| `server/routes/search.mjs` | `/api/search` SSE. |
| `server/routes/sessions.mjs` | App-session/pairing REST, scenario persistence REST, upload REST. |
| `server.mjs` | Now ~240 lines: env validation, Express bootstrap, dependency wiring, route mounting, `server.listen`. No route handlers of its own. |
| `server/hub.mjs` | +join rate-limiting/failed-attempt disconnect, +`ROLE_GATED_TYPES` check in `handleMessage`. |
| `server/scenarios.mjs` | `updateScenario` now validates `script.turns`/`glossary` shape when those keys are present in the patch (previously only the create path checked this). |

**Frontend (`ae274d9`)**

| File | What it owns |
| --- | --- |
| `src/hooks/use-setup-chat.ts` | Everything behind the setup screen's persistent Luna chat: transcript, guide-chat wiring, chat-triggered search, classification watchdog, the conversation-first `candidate` confirm/reject state machine. |
| `src/hooks/use-call-mic-input.ts` | Push-to-talk + VAD capture, the press/release/latch state machine, the Space-bar hotkey. |
| `src/hooks/use-call-ws-events.ts` | Pure subscription wiring for the hub's `control`/`turn`/`phase` broadcasts — stateless. |
| `src/components/setup/{TalkButton,SearchStatusLine,SearchPapersOverlay,CandidateConfirm,LunaChatPanel}.tsx` | Moved out of `SetupScreen.tsx` verbatim (`LunaChatPanel` composes the other three). |
| `src/components/setup/SetupScreen.tsx` | 1091 → ~400 lines. Composes `useSetupChat` + the above; keeps doc-analysis, restore-from-storage, scenario-delivery, door-intro (its own concerns). |
| `src/components/call/CallScreen.tsx` | 660 → ~470 lines. Composes `useCallWsEvents` + `useCallMicInput`; keeps script-player/cheat-sheet/brain-phase logic. |
| `src/components/phone/PhoneApp.tsx` | `hasCode` now driven by a real `hashchange` listener instead of an incidental-re-render-dependent `useMemo` — a genuine bug fix surfaced by the exhaustive-deps audit, not just a lint fix. |
| `src/components/setup/DocUpload.tsx` | Rejects images over 8 MB client-side before reading them into memory (server's `/api/uploads` JSON body cap is 12 MB, ~9 MB raw after base64). |

## Known next work

None queued from this pass. If you're picking this up cold, check `git log` / GitHub issues for
anything opened since 2026-08-25 before assuming this list is current.

## Workflow rules (user-directed — follow these, same as `handoff-phase7b.md`)

- Leave work **UNCOMMITTED** for the user's review unless explicitly told to commit; never push or
  deploy without an explicit request each time (not a standing authorization from a past one).
- Commit style: `type: gist` subject (conventional-commits-ish — `fix:`/`refactor:`/`docs:`), body
  with rationale + verification evidence, `Co-Authored-By` trailer. See `git log` for examples.
- Deploy (only when asked):
  `git archive HEAD | tailscale ssh core 'cd /home/jon/docker/tagteam && tar -x'` then
  `tailscale ssh core 'cd /home/jon/docker/tagteam && docker compose up -d --build'`. Verify with
  `tailscale ssh core 'docker ps --filter name=tagteam-api'` and
  `curl -s -o /dev/null -w "%{http_code}\n" https://tagteam.mango-rockhopper.ts.net/`.
- Before recommending or reusing a route/hook by name, verify it still exists (`grep`/`Read`) —
  this doc is a point-in-time snapshot, not live state.

## Environment quirks (see `docs/handoff-phase7b.md` for the fuller list — still accurate)

- **pnpm only**; Node >= 22.
- Homelab LLM (`LLM_BASE_URL` on tailnet): 13–80s per call; size timeouts accordingly. Prod STT is
  hosted; local default is whisper-cpp (needs the model under `models/`).
- `zsh` arrays are 1-indexed, unlike `bash` — if you script anything with parallel indexed arrays
  (e.g. titles/bodies/labels for a batch of API calls) in a shell tool that defaults to zsh, either
  avoid positional array indexing entirely or explicitly invoke `bash -c '...'` — an index-by-one
  mismatch here silently paired the wrong body with the wrong title across a batch of 14 GitHub
  issue creations in this pass (caught by verification before it was reported done, but avoid
  hitting it in the first place).
