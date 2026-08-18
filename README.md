<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="TagTeam — practice Japanese office calls with a live avatar coach">
</p>

# TagTeam

**Your personal Japanese call coach.** Practice real bureaucracy phone calls with a live 3D avatar before you ever dial — upload the letter you received (or just describe the problem), and TagTeam builds the call around it.

## Why it exists

Living in Japan means phone calls — to the ward office, the dentist, the tax office — in rapid, formal Japanese you never practiced and can't pause. For non-native residents, a wrong word costs a re-do and silence costs confidence.

TagTeam turns that wall into a safe practice room.

## See it in action

<p align="center">
  <img src="./assets/readme/screenshot-guide.webp" width="100%" alt="Luna the avatar guide greets you with a welcome message and a Get started button over an anime scene">
</p>

Try it: **Get started → upload a letter (or describe the issue) → pick who answers the phone, difficulty and pace → Start call.** Luna suggests the right office staff from your document, then either read your lines or hold-to-talk for a live reply from the avatar.

## What it does

1. **Ground** — upload a photo of your notice or letter, or just describe the issue. TagTeam asks 1–2 quick English questions to pin down your call's objective.
2. **Research (optional)** — look up the office you're calling (real web results via SearXNG + Firecrawl) so the practice mirrors reality, not a generic script.
3. **Practice** — Luna suggests who answers (receptionist, claims desk, or accounts) from your document; you confirm, pick difficulty/pace, and an avatar in that office role runs a Japanese call. Read your lines or **hold to speak** — the avatar answers like the real office.
4. **Review** — a scan-friendly cheat sheet captures your goal, the exact if-then phrases, the office rules to know before you call, and what to practice.

<p align="center">
  <img src="./assets/readme/workflow.svg" width="100%" alt="From a letter to a confident call: ground, research, practice, review">
</p>

## What makes it different

- **A real co-pilot, not a script reader.** Live vocabulary cards (kanji, furigana, English) appear at 5x size the moment the word is spoken — on the desktop and on your phone.
- **Pause on your terms.** Tap a word for a quick hint; hold to pause the call at the next turn and have the avatar break it down — then resume.
- **The right office staff.** Luna suggests who answers the phone from your document — confirm or pick another (Reception / Claims desk / Accounts); the persona, avatar, scene, and voice follow your choice.
- **Build on your past calls.** Scenarios are saved automatically and restored from the setup screen.
- **Built on real avatar tech.** The Perxona Connect Kit `<sv-presenter>` web component — tokens minted via a thin backend proxy, with real avatar/scene/voice/motion catalogs.

## Getting started

```bash
pnpm install
cp .env.example .env   # fill PERXONA_CONNECT_EMAIL/PASSWORD + LLM_API_KEY
pnpm dev               # api :8083 + web :5173
```

Open http://localhost:5173. Verify: `pnpm build && pnpm lint && pnpm test`. Production: `pnpm build && pnpm start`.

**Full walkthrough — accounts, your own search/scraping (SearXNG + Firecrawl), and troubleshooting: see [`SETUP.md`](SETUP.md).**

## Notes

- Accounts are handled by **better-auth** (email/password) — log in to reach the app.
- The Connect identity lives server-side (env-held credentials) and never reaches the browser.
- The LLM runs through a server-side proxy (`/api/llm`); the API key never reaches the browser.
- Built with React 19 + Vite + TypeScript + Tailwind CSS and an OpenAI-compatible LLM.

## Repo map

- `server.mjs` — Express app: better-auth login gate, minted connect tokens, avatar/scene/voice/motion catalog proxy, session hub, orchestrator, `/api/tts`, serves the built app.
- `server/` — auth, Drizzle+SQLite schema/db, WebSocket session hub, scenario persistence, call orchestrator + nextTurn brain, provider layer (LLM/STT/TTS/chatbot/search).
- `src/shared/contract.ts` — cross-module data contract (SimScript, Glossary, CheatSheet, player API, WS protocol, coaching settings).
- `src/lib/` — api/presenter (Connect), llm/doc-parser/sim-engine/glossary/cheat-sheet/coaching (AI pipeline + settings), audio/tts (speech).
- `src/hooks/` — React bindings; `use-script-player` is the sentence-queue driving the call; `use-push-to-talk` is the mic.
- `src/state/` — app store, avatar context, session (hub) context.
- `src/components/` — `setup/`, `call/`, `cheat-sheet/`, `stage/`, `phone/`, `session/` UI.
