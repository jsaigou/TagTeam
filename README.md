# TagTeam

AI-powered voice simulator and live co-pilot that helps non-native residents confidently
navigate complex Japanese bureaucracy and administrative phone calls.

## Workflow

1. **Setup & grounding** — upload a photo of an official document; the AI asks 1–2 quick
   English grounding questions to establish the call objective.
2. **Interactive voice simulation** — practice a call with a professionally dressed bureaucrat
   avatar speaking natural, authentic-speed Japanese.
3. **In-call assistance** — live Kanji/Furigana/English pop-ups for key vocabulary; **Tap Help**
   (visual hint, call keeps playing); **Hold Help** (pauses at the next turn boundary with a
   verbal breakdown).
4. **Post-call deliverable** — a scan-friendly cheat sheet with core goals and "if-then"
   conditional phrases for the real call, plus targeted practice recommendations.

Built on the Perxona Connect Kit (`<sv-presenter>` avatar Web Component) and an OpenAI-compatible
LLM (the foundry a0 router, `gemma4-mtp`). The Connect identity lives server-side in `server.mjs`
(env-held credentials) — there is no user login; the browser gets a minted connect_token. The LLM
key ships to the browser (demo tradeoff).

## Getting Started

```bash
pnpm install
cp .env.example .env   # fill PERXONA_CONNECT_EMAIL/PASSWORD + VITE_LLM_API_KEY
pnpm dev               # api :8083 + web :5173
```

Verify: `pnpm build && pnpm lint && pnpm test`. Production: `pnpm build && pnpm start`.

## Repo map

- `server.mjs` — Express proxy: mints connect tokens, proxies the avatar/scene/voice catalog,
  serves the built app.
- `src/shared/contract.ts` — cross-module data contract (SimScript, Glossary, CheatSheet, player API).
- `src/lib/` — api/presenter (Connect), llm/doc-parser/sim-engine/glossary/cheat-sheet (AI pipeline).
- `src/hooks/` — React bindings; `use-script-player` is the sentence-queue driving the call.
- `src/components/` — `setup/`, `call/`, `cheat-sheet/`, `stage/` UI.

See `CONTRACT.md` for the build contract and presenter SDK constraints.
