# TagTeam — Build Contract

**TagTeam** is an AI-powered voice simulator and live co-pilot that helps non-native residents
confidently navigate complex Japanese bureaucracy phone calls.

- Simulate a call with a professionally-dressed bureaucrat avatar speaking authentic Japanese.
- Live copilot: non-intrusive Kanji/Furigana/English pop-ups, Tap Help (visual hint, call keeps
  playing), Hold Help (pause + verbal breakdown).
- Post-call scan-friendly cheat sheet (goal, if-then phrases, practice tips).

## Module ownership (three parallel workstreams — NO file overlap)

| Owner | Area | Owns |
|---|---|---|
| **connect-core** | Connect integration + script player | `server.mjs` (backend proxy: token mint + catalog), `src/lib/api.ts`, `src/lib/presenter.ts`, `src/hooks/use-catalog.ts`, `src/hooks/use-presenter.ts`, `src/hooks/use-avatar-session.ts`, `src/hooks/use-script-player.ts`, `src/components/stage/*` |
| **ai-pipeline** | Pure logic (no UI), unit-tested | `src/lib/llm.ts`, `src/lib/doc-parser.ts`, `src/lib/sim-engine.ts`, `src/lib/glossary.ts`, `src/lib/cheat-sheet.ts`, `src/prompts/*`, `src/fixtures/*` |
| **ui-copilot** | UX + in-call layer | `src/App.tsx`, `src/main.tsx`, `src/components/setup/*`, `src/components/call/*`, `src/components/cheat-sheet/*`, `src/state/*`, `src/index.css`, `index.html` |

**Coordinator-owned (import-only, do NOT edit):** `src/shared/contract.ts`, `CONTRACT.md`,
`AGENTS.md`, `components.json`, root config files.

## Data flow

```
DocInput (photo) → GroundingQuestion(s) → GroundingAnswer(s)
   → SimScript + GlossaryEntry[]           (ai-pipeline)
   → ScriptPlayer (per-turn present())     (connect-core)
   → CheatSheet                            (ai-pipeline)
```

Every cross-boundary shape is defined in `src/shared/contract.ts`. Agents import from there.

## Presenter SDK constraints (must design to these)

Loaded from `src/lib/presenter.ts` (connect-core). From the Connect Kit:
- `presenter.initialize(token, { avatarId, sceneId, voiceId? })` — resolve avatar/scene/voice.
- `resumeAudioPlayback()` MUST run from a direct user gesture (the "Start call" click).
- `present(content)` NEVER rejects — resolves `PresentationResult`; `success` may be false.
- **No pause API exists.** "Hold Help" pauses at the next turn boundary: the ScriptPlayer stops
  advancing the queue; the verbal breakdown is a normal `present(explanationJp)`.
- Events: `PLAYING_SPEECH_TEXT` (text now being spoken — drives vocab pop-ups),
  `PERFORMANCE_STATE`/`PERFORMANCE_END`, `CONNECT_TOKEN_EXPIRED`.
- Avatar/scene/voice can be swapped atomically by calling `initialize()` again with a new target.
- Motions are per-avatar-skeleton pre-recorded clips; `motion` on a Turn is optional markup.

## Verification (each agent, before reporting done)

```bash
pnpm install && pnpm build && pnpm lint
```

ai-pipeline additionally: `pnpm test`.

## Secret hygiene

- `.env` is git-ignored. NEVER commit `.env` or real keys; only `.env.example` (placeholders).
- Connect credentials (`PERXONA_CONNECT_EMAIL`/`PERXONA_CONNECT_PASSWORD`) live SERVER-side in
  `server.mjs` and never reach the browser; the browser gets a minted connect_token from
  `GET /api/connect-token`.
- The LLM key lives in `VITE_LLM_API_KEY` in `.env` — a Vite env var exposed to the browser
  (accepted tradeoff for this demo).
- Before committing run: `git grep -nE '(sk-[A-Za-z0-9]{20}|api[_-]?key|password|secret)[:=][[:space:]]*[^$]'`.

## Visual direction (light theme, nature feel)

Palette (tokens already set in `src/index.css`; extend with tints/shades, not limited to these):

- `#386641` **forest** — primary actions, headings, brand
- `#6A994E` **leaf** — secondary/accents, focus rings
- `#A7C957` **lime** — highlights, active states (e.g. live vocab chip)
- `#F2E8CF` **cream** — background / warm paper surfaces
- `#BC4749` **terracotta** — emphasis only: errors, destructive, critical in-call states (Hold Help)

Direction: calm, trustworthy, slightly bureaucratic-but-modern. Warm cream surfaces, forest-green
primary buttons, leaf/lime accents. Keep the avatar as the hero on the call stage; co-pilot UI is
floating cards. Default theme is LIGHT; the `.dark` variant is an optional deep-green night mode —
build for light first. Terracotta is a sparing high-emphasis accent, never the background.
