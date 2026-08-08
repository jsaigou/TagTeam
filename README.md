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
LLM. Pure frontend — auth and the LLM key run in the browser (demo tradeoff).

## Getting Started

```bash
pnpm install
cp .env.example .env   # fill VITE_PERXONA_API_BASE_URL, VITE_LLM_API_KEY, VITE_LLM_MODEL
pnpm dev
```

Verify: `pnpm build && pnpm lint && pnpm test`.

## Repo map

- `src/shared/contract.ts` — cross-module data contract (SimScript, Glossary, CheatSheet, player API).
- `src/lib/` — auth/api/presenter (Connect), llm/doc-parser/sim-engine/glossary/cheat-sheet (AI pipeline).
- `src/hooks/` — React bindings; `use-script-player` is the sentence-queue driving the call.
- `src/components/` — `setup/`, `call/`, `cheat-sheet/`, `stage/` UI.

See `CONTRACT.md` for the build contract and presenter SDK constraints.
