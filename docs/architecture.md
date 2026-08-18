# TagTeam — Architecture

Authoritative reference for the production build of TagTeam. Phase 0 (spike) findings live in
[`phase0-spike.md`](./phase0-spike.md); this document supersedes the older `CONTRACT.md` module
split where they conflict, and `src/shared/contract.ts` remains the import-only home of the shared
data shapes.

## 1. Product & principles

**What it is:** an AI voice simulator + live co-pilot that helps non-native residents practice real
Japanese bureaucracy phone calls against a live Perxona `<sv-presenter>` avatar, grounded in the
*specific* office they need to reach (mailings + that office's website/rules).

**Guiding principles**

1. **Guided, tightly-scoped LLM work.** A hand-written orchestrator, never an autonomous agent.
   Every LLM call is a fixed, schema-validated JSON task (see §5). The model never chooses actions.
2. **Perxona-first.** The Perxona avatar/voice is the default and the hero (sponsor). BYO providers
   are explicit opt-ins behind interfaces; the app degrades gracefully when only Perxona is set.
3. **Provider abstraction (BYOK).** Every external capability sits behind an interface + env flag,
   so a homelab (LLM, whisper, SearXNG, Firecrawl, camofox) is reusable *and* a bare install works.
4. **Server-authoritative sessions.** Call state, transcript, vocab and help live on the server,
   so any device combination (desktop / hybrid / phone-only) works and history persists.
5. **Multi-device by QR.** A phone joins the desktop session by scanning a QR code, acting as
   camera + microphone + full control surface — or runs the whole app alone.
6. **Target-specific grounding with geo-scoping.** The scenario is built from the user's documents
   AND the specific office's located, scraped rules — surfaced for confirmation (never
   wrong-country info silently).
7. **Single-container deploy goal.** One Node image, SQLite file on a volume. A compose file with
   optional sidecars (Postgres, whisper) is acceptable.

## 2. System context

```
                       ┌──────────────────────────────────────────────┐
                       │  Node server (one image, Tailscale reachable) │
                       │  Express · better-auth · Drizzle(SQLite)     │
                       │  WebSocket session hub                       │
                       │  ephemeral upload store (auto-delete)        │
                       │  orchestrator (scoped LLM actions)           │
                       │  provider layer                              │
                       └──────┬───────────────┬───────────────┬───────┘
                              │ WS            │ WS            │
                 ┌────────────▼───┐  ┌────────▼──────┐  ┌─────▼────────────┐
                 │ Desktop        │  │ Phone (QR)    │  │ Phone-only       │
                 │ <sv-presenter> │  │ camera+mic+   │  │ everything       │
                 │ mic + control  │  │ control       │  │ (full app)       │
                 └────────────────┘  └───────────────┘  └──────────────────┘
                              │
         Homelab (BYOK, optional)         External (BYOK, optional)
         SearXNG · Firecrawl · camofox    LLM (OpenAI-compat)
         whisper.cpp · own inference      Connect Chatbot (Gemini)
         kokoro / qwen TTS                (hosted STT/TTS)
```

Perxona Connect (`/presentation`, catalog, chatbots, TTS tokens) is reached server-side with the
shared Connect identity; the browser only ever holds a short-lived `connect_token` for the
`<sv-presenter>` widget.

## 3. Device modes (one app, N devices)

A **session** has connected **devices**, each with capabilities:

| Capability | Desktop | Phone (companion) | Phone (solo) |
| --- | --- | --- | --- |
| Render avatar (`<sv-presenter>`) | ✅ | – | ✅ |
| Push-to-talk mic → STT | ✅ | ✅ | ✅ |
| Document camera + scan | ✅ | ✅ | ✅ |
| Control (hold/resume/tap-help) | ✅ | ✅ | ✅ |

Device roles: `stage` (renders avatar + audio out), `input` (mic/camera), `control`. A device can
hold several. The server is authoritative for all state; devices are thin views + inputs.

## 4. Data model

All cross-boundary shapes are defined (and will be extended) in `src/shared/contract.ts`.

**Domain additions over the current contract**

```ts
// Target-specific grounding
type TargetProfile = {
  id: string;
  name: string;            // official name, e.g. 医療法人社団 聖優会 渋谷デンタルクリニック
  url?: string;            // canonical website
  address?: string;        // + geoScope derived for search scoping
  geoScope: { country: "jp"; language: "ja-JP"; city?: string };
  rules: TargetRule[];     // extracted, each with a citation
  confidence: number;      // user-confirmed match
};
type TargetRule = { id: string; rule: string; source: string; kind: "hours" | "booking" | "required_docs" | "cancellation" | "fees" | "notes" };

// Scenario / call
type Turn = { id; speaker; jp; en?; vocab: string[]; motion?; emotion?; intensity? };  // + emotion/intensity
type SimScript = { scenarioTitle: string; target: TargetProfile; turns: Turn[] };      // + target
type CheatSheet = { goal; keyPhrases; practice; targetRules?: TargetRule[] };          // + target rules

// Phase 4 — coaching settings (threaded into script generation + nextTurn)
type CallSettings = { role: RoleId; difficulty: "beginner"|"intermediate"|"advanced"; pace: "slow"|"normal"|"fast" };

// Adaptive call state (server-owned)
type CallState = { sessionId; script; glossary; turnIndex; mode: "guided" | "free"; phase: "listening" | "thinking" | "talking" | "user" | "held" | "ended"; transcript: Turn[]; };
```

**Persistence (Drizzle + SQLite, `better-sqlite3`)**

| Table | Purpose |
| --- | --- |
| `user` (better-auth) | App accounts |
| `session` (better-auth) | App auth sessions |
| `account` / `verification` (better-auth) | OAuth + email verification |
| `app_session` | `{ id, userId, status, pairingToken, pairingExpiresAt, createdAt }` — the QR-able unit |
| `scenario` | `{ id, userId, sessionId, docSummary, target, script, glossary, cheatSheet, createdAt }` — JSON blobs + indexed user/created |

SQLite is the default; Drizzle makes Postgres a config swap. No user documents are persisted
beyond the short-lived upload store (§8).

## 5. Pipeline — scoped LLM actions

The orchestrator (`src/state/orchestrator.ts`-style, server-side for multi-device) executes a fixed
set of schema-validated actions. Each returns JSON validated against the contract; failures are
typed, retried once, then surfaced.

```
DocInput(s) ─▶ parseDocument (own-LLM, multimodal) ─▶ DocSummary + GroundingQuestions
answers    ─▶ identifyTarget (doc-prefill + ask + optional URL) ─▶ { name, url?, confidence }
              └▶ geolocate (mailing address / user confirm / ja-JP) ─▶ geoScope
mailings + url ─▶ research (SearXNG language=ja-JP) ─▶ scrape (Firecrawl/camofox)
              └▶ extractTargetRules ─▶ TargetProfile (citations) ─▶ user confirms
doc + answers + target ─▶ planScenario ─▶ SimScript + Glossary
call state ─▶ nextTurn ─▶ { jp, en, vocab, emotion, intensity }      (guided or free)
stuck       ─▶ suggestReply  ·  user utterance ─▶ assessTurn (optional coaching)
script + glossary ─▶ cheatSheet (goal, phrases, practice, targetRules)
```

Every step is deterministic orchestration: the model produces exactly one JSON object per prompt,
validated before use. No tool-calling, no autonomous loops.

## 6. Presenter layer (full 0.2.0 surface)

`src/lib/presenter.ts` / `use-presenter.ts` are upgraded to the verified surface:

- `present(text, { emotion, intensity })` — per-turn facial expressions (verified live).
- `setListening(true)` / `setThinking(true)` — avatar visibly listens while the user speaks and
  thinks while the brain generates (verified).
- `presentWithAudio(wavBuffer, text, opts)` — BYO TTS (kokoro/qwen) provider option (verified).
- `muteAudio`, `updateCameraAngle(fullbody|halfbody)`.
- New events: `SPEECH_TOKEN_EXPIRED`, `ASSET_LOADING_PROGRESS`, `AUDIO_PLAYBACK_STATE`.
- Camera defaults: `updateCameraFOV({ distance: 1, vertical: 0, horizontal: 4.5 })` as today.

**Real-conversation loop (Phase 3):**
hold-to-talk (16 kHz mono WAV) → `setListening(true)` while recording → `POST /api/audio` +
WS `audio` message → server STT (whisper.cpp/hosted) → `nextTurn` (server orchestrator) →
`setThinking(true)` while generating → `present(reply, { emotion, intensity })`. Desktop and phone
companion share this one path (see §9).

## 7. Providers

Server-side interfaces, each with an env-flag default and an alternative:

| Interface | Default | Alternative |
| --- | --- | --- |
| `LlmProvider.chat()` | OpenAI-compatible BYOK (`LLM_BASE_URL`) | – |
| `ChatbotProvider.nextTurn()` | Connect Chatbot (`/chatbots/:id/chat`) | own-LLM via `LlmProvider` (fallback) |
| `SttProvider.transcribe()` | whisper.cpp subprocess | hosted OpenAI-compatible `audio/transcriptions` |
| `AvatarSpeechProvider` | Perxona `<sv-presenter>` | `presentWithAudio` (kokoro/qwen) |
| `SearchProvider.search()` | SearXNG (`language=ja-JP`) | none (feature disabled) |
| `ScrapeProvider.scrape()` | Firecrawl | camofox (BYO) |

Env example: `LLM_PROVIDER=openai|anthropic|connect`, `STT_PROVIDER=whisper-cpp|hosted`,
`TTS_PROVIDER=perxona|byo`.

## 8. Security & privacy

- **PII.** Uploaded document photos go to an ephemeral store: random `uploadId`, 10-min TTL,
  deleted on desktop ack or TTL. Never written to the DB, never logged. TLS in transit.
- **Connect tokens.** Minted server-side from the single env identity; short-lived; the
  `CONNECT_TOKEN_EXPIRED` event rotates them via `refreshConnectToken`. Never logged.
- **Auth.** better-auth (email/password + optional OAuth), rate-limited login, session cookies.
- **API hardening.** Rate limiting on `/api/connect-token`, `/api/llm`, `/api/stt`,
  `/api/search`, `/api/chatbots*`; body-size limits; validation on every input.
- **Search/LLM are server-side only** — the browser never holds the LLM/STT keys, and Connect
  tools cannot reach private IPs (SSRF protection), so research stays on the server.
- **Wrong-country guard.** Searches are scoped `language=ja-JP` + location terms, and the located
  target + extracted rules are always shown for user confirmation before a scenario is built.

## 9. WebSocket protocol (session hub)

```
join      { sessionId, pairingToken, capabilities }      → device role assigned
state     { callState }                                  → broadcast on every change
turn      { turn, end? }                                 → orchestrator conversation turns
phase     { thinking | idle }                            → brain state (avatar mirroring)
control   { hold | resume | tapHelp(entryId) }           → any device
audio     { audioId } → stt → nextTurn                  → orchestrator → turn/phase
upload    { uploadId, filename }                         → pushed to the stage device
ack       { uploadId }                                   → server deletes the ephemeral file
```

Phase 3 detail: a device captures push-to-talk WAV (16 kHz mono), POSTs it to `/api/audio` (the
same ephemeral store as scanned pages), then announces the store reference over the hub. The server
orchestrator (`server/orchestrator.mjs`) runs STT (whisper.cpp, `server/providers.mjs`) + `nextTurn`
(`server/next-turn.mjs`) against the per-session context seeded by
`POST /api/sessions/:id/call-context`, and broadcasts the transcribed user turn + the generated
bureaucrat reply as `turn` messages with `phase: thinking` around the pipeline. The stage presents
bureaucrat turns (avatar `setThinking` while generating); companions render the same `turn`s.

Reconnect: devices rejoin by `sessionId` + (for companions) the pairing token; the stage device
re-initializes the presenter with the persisted scenario. The orchestrator's context + transcript
are keyed by session, independent of WS connections, and cleared when the room empties.

## 10. Deployment

- **One image** (`Dockerfile`): Node 22+ runtime, built `dist/`, SQLite file on `/data` volume,
  `better-auth` secret + provider keys via env. `pnpm start` serves app + API.
- **Optional compose** adds Postgres (swap Drizzle driver) and/or a whisper.cpp sidecar when the
  embedded subprocess is not wanted.
- **Networking**: reachable via Tailscale (e.g. `tagteam.mango-rockhopper.ts.net`); the QR encodes
  the reachable URL + `sessionId` + short-lived pairing token.
- Env contract stays in `.env.example` (server keys only in env, never the browser).

## 11. Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 0 — Research + spike | Perxona capabilities, runtime wiring, geo-search | ✅ done — `docs/phase0-spike.md` |
| 1 — Foundation | Architecture doc (this); presenter full surface; provider layer; remove canned demo; better-auth + Drizzle/SQLite (login gate + UI); containerize | ✅ done |
| 2 — Multi-device + scanning | QR pairing, OpenCV.js edge-detect/crop, multi-page upload, phone control, 3 modes (WebSocket session hub) | ✅ mostly done — see below |
| 3 — Real conversation | `/api/stt` (whisper.cpp), push-to-talk, `nextTurn` adaptive brain, listening/thinking | ✅ done — see below |
| 4 — Coaching + showcase | emotion/intensity wiring, motion catalog browser, roles, difficulty/speed, target rules in cheat sheet, Perxona branding | ✅ done — see below |

**Phase 1 completed:** presenter layer at full 0.2.0 surface (`setListening/setThinking`,
`present(text,{emotion,intensity})`, `presentWithAudio`, `muteAudio`, `updateCameraAngle`,
`SPEECH_TOKEN_EXPIRED` event); `emotion`/`intensity` threaded through `Turn` and the script player;
canned dentist demo removed from the UI; better-auth + Drizzle + SQLite with a login/sign-up gate and
auth-protected `/api` routes; provider config module (`server/providers.mjs`); Dockerfile +
docker-compose + `.dockerignore`; SearXNG search geo-scoped `language=ja-JP`.

**Phase 2 completed (this round):** the WebSocket session hub (`server/hub.mjs`, attached at
`/api/ws`) with rooms per `app_session`, role assignment (stage is exclusive), reconnect-friendly
`join`/`state`/`control`/`upload`/`ack` protocol, and an in-memory ephemeral upload store (10-min
TTL, deleted on ack); session REST (`POST /api/sessions`, `/current`, `/:id/rotate-pairing`,
uploads) backed by the existing `app_session` table; a desktop QR pairing panel (join URL + 6-char
code); a phone companion route (`/phone`) with manual-code fallback, live `AppSnapshot` mirror,
Hold/Resume control, and page scanning; OpenCV.js document edge-detect + perspective crop
(`src/lib/scan.ts`, lazy-loaded from `VITE_OPENCV_URL`); multi-page document bundles
(`DocInput.kind: "images"`) through the parse pipeline. All three device modes now exist: desktop
(stage), phone companion (input+control), phone solo (the app itself on a phone).

**Phase 2 deferred:** the `audio → stt → nextTurn` message and companion mic shipped with
Phase 3. Companion tap-help UI is driven by the protocol but has no phone-side vocab picker yet —
desktop vocab chips still show Tap-help. In-app camera QR *scanning* was skipped in favor of the
native camera app + manual code.

**Phase 3 completed (this round):** the STT provider (`server/providers.mjs` — whisper.cpp
subprocess by default, hosted OpenAI-compatible via `STT_PROVIDER=hosted`) + `POST /api/stt`;
push-to-talk (raw PCM → 16 kHz mono WAV, `src/lib/audio-utils.ts` + `src/hooks/use-push-to-talk.ts`)
on desktop and the phone companion; the server orchestrator (`server/orchestrator.mjs`) owning
per-session scenario context + running transcript (seeded via `POST /api/sessions/:id/call-context`);
the adaptive `nextTurn` brain (`server/next-turn.mjs`, own-LLM with one retry, emotion/intensity/
vocab validation, `done` end signal); the `audio` hub message (bytes via the ephemeral store +
`POST /api/audio`, then WS `{ type: "audio", audioId }`) driving `audio → stt → nextTurn → turn`;
`turn` + `phase` broadcasts that keep the avatar's `setListening`/`setThinking` and the phone's
transcript in sync. Verified live end-to-end: whisper → STT → nextTurn → avatar reply with
accumulated context.

**Phase 3 deferred:** Connect Chatbot as a `nextTurn` backend (own-LLM is the default; the chatbot
`ChatbotProvider` interface from §7 remains unimplemented). Coaching/emotion polish landed in
Phase 4.

**Phase 4 completed (this round):** coaching settings (roles / difficulty / pace) in the scenario
step — `Who answers the phone` (Reception / Claims desk / Accounts), `Difficulty`
(Beginner/Intermediate/Advanced) and `Pace` (Slow/Normal/Fast). The persona data lives in
`src/shared/coaching.json` (the single source shared by the client's script generation via
`src/lib/coaching.ts` AND the server's nextTurn brain via `server/coaching.mjs`, so the two never
drift); the composed directive is injected into both the sim prompt and the live `nextTurn` system
prompt. Settings thread through `CallSettings` (contract) → `app_session` call-context
(`POST /api/sessions/:id/call-context`) → `buildNextTurnMessages`. **Emotion/intensity wiring:**
`SIM_SCHEMA` turns now emit `emotion`/`intensity` (validated in `isTurn`), the script player
already passes them to `present()`, and the live UI shows a `emotion · intensity` badge on the
active bureaucrat turn (speaking indicator + transcript). **Motion catalog browser:** the Connect
per-avatar motions endpoint is proxied at `GET /api/avatars/:id/motions`; the `MotionBrowser`
dialog (call screen header) lists the practice avatar's gestures and previews any of them via
`playMotion`. **Target rules in the cheat sheet:** `CheatSheet.targetRules: TargetRule[]` (contract
+ schema + validator), extracted from the reference digest by the cheat-sheet prompt and rendered
as a `Know before you call` section (with source citations + kind badges). **Perxona branding:**
`PerxonaBadge` on the invite screen + cheat-sheet footer. The Dockerfile runtime stage now copies
`src/shared` so the server can read `coaching.json`.

**Phase 4 deferred:** no in-app camera QR scanning yet (native camera app + manual code); the
`roles`/`difficulty`/`pace` settings are session-level, not yet persisted per scenario row;
`presentWithAudio` codec guarantees still unverified on real hardware.

## 12. Open questions

- Per-org vs shared Connect identity for the event — confirm with Perxona.
- `presentWithAudio` codec/format guarantees on real hardware (16 kHz WAV accepted headless).
- Chatbot chat latency under conversation cadence (30 calls/min limit).
- Whether OpenCV.js ships best as a vendored WASM or a CDN dependency (bundle size vs offline).
  *Phase 2: lazy CDN load with `VITE_OPENCV_URL` override + raw-frame fallback; revisit vendoring
  for fully-offline deployments.*
