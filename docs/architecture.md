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
| `nextTurn` backend | own-LLM via `LlmProvider` (default) | Connect Chatbot (`NEXTTURN_PROVIDER=connect-chatbot`, `/chatbots/:id/chat`) |
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
  `/api/search`, `/api/chatbots*`; body-size limits; validation on every input. Every named
  limiter (HTTP routes in `server/routes/*.mjs`, the WS hub's join-attempt check below) shares one
  registry + sweep interval via `server/rate-limit.mjs` — add a new limiter by picking a unique
  name, not by hand-rolling another `Map`/`setInterval`.
- **WS hub hardening.** Pairing codes are 6 chars over a 32-symbol alphabet (~10⁹ space) — `join`
  attempts are rate-limited per IP (`server/rate-limit.mjs`) and a connection is dropped after
  repeated invalid codes. A device that joined without declaring a role (`capabilities: []`) is
  refused any state-mutating message (`audio`/`intent`/`confirm`/`cancelRun`/`upload`/`ack`) —
  see `ROLE_GATED_TYPES` in `server/hub.mjs`.
- **Search/LLM are server-side only** — the browser never holds the LLM/STT keys. Outbound scrape
  targets (`server/steps/scrape.mjs`, reached from both `research.mjs`'s objective-embedded URLs
  and `extractTargetRules.mjs`'s confirmed candidate) are checked by `server/ssrf-guard.mjs`
  before being forwarded to Firecrawl — non-http(s) schemes and loopback/private/link-local hosts
  (including the cloud metadata address) are rejected — so research stays on the server without
  becoming a proxy into internal infrastructure.
- **Upload content checking.** `POST /api/uploads` sniffs the actual bytes with
  `server/file-sniff.mjs` (`isImageContent`) rather than trusting the client-reported
  `Content-Type`, which is attacker-controllable.
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

Hardening (§8, Phase 7d): `join` is rate-limited per IP and a connection is dropped after repeated
invalid pairing codes; a device with no declared role is refused `audio`/`intent`/`confirm`/
`cancelRun`/`upload`/`ack`.

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
| 2 — Multi-device + scanning | QR pairing, OpenCV.js edge-detect/crop, multi-page upload, phone control, 3 modes (WebSocket session hub) | ✅ done — see below |
| 3 — Real conversation | `/api/stt` (whisper.cpp), push-to-talk, `nextTurn` adaptive brain, listening/thinking | ✅ done — see below |
| 4 — Coaching + showcase | emotion/intensity wiring, motion catalog browser, roles, difficulty/speed, target rules in cheat sheet, Perxona branding | ✅ done — see below |
| 5 — Companion + persistence | in-app camera QR scanning, per-role avatar packs, scenario persistence, Connect Chatbot nextTurn, phone vocab picker, BYO TTS | ✅ done — see below |
| 7b — client→server migration | background job runner, step graph + run engine, confirmTarget gate, planScenario/parseDocument/cheatSheet as graph steps, intent-message UI | ✅ done — see below |
| 7c — UI usability | chrome cleanup (stepper removed, app footer, mobile transcript access), main-surface audio controls + chat cleanliness | ✅ done |
| 7d — Security & code-quality hardening | WS join rate-limit + role gating, SSRF guard on scrape, upload content sniffing, shared rate-limiter, `server.mjs` route-module split, `SetupScreen`/`CallScreen` hook extraction | ✅ done — see below |

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
Phase 3. The remaining Phase 2 deferred items landed in Phase 5: the phone-side vocab picker
(`AppSnapshot.activeVocab`, Phase 5e) and in-app camera QR *scanning* (`CameraScanner`, Phase 5a).

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

**Phase 3 deferred:** ~~Connect Chatbot as a `nextTurn` backend~~ (landed in Phase 5d, see below).

**Phase 5 — Connect Chatbot as the live brain (this round):** the adaptive `nextTurn` backend is now
swappable via `NEXTTURN_PROVIDER`. Default `own-llm` (unchanged). `connect-chatbot` routes every
nextTurn call through a Connect Chatbot (`/chatbots/:id/chat`, stateless, Connect message format):
the chatbot's `custom_instructions` carry the persona (created once — see SETUP.md §5c), each call's
scenario context + coaching directives + transcript are sent as one user message, and the nextTurn
JSON schema is appended so the reply parses through the same validated-turn pipeline. Own-LLM stays
the fallback/default; the chatbot is the sponsor showcase path (30 calls/min limit).

**Phase 5 — phone-side vocab picker (this round):** `AppSnapshot` gains `activeVocab`
(`GlossaryEntry[]` for the active turn), so the phone companion renders Tap-help chips for the
bureaucrat's current turn without holding the full glossary. Tapping a chip shows the word's
definition/note inline on the phone AND drives the existing `tapHelp` control message so the stage's
avatar speaks the same hint — companion and stage stay in sync. The desktop `VocabOverlay` tap-help
is unchanged.

**Phase 5 — BYO TTS (this round):** `TTS_PROVIDER=byo` + `VITE_TTS_PROVIDER=byo` routes avatar
speech through an OpenAI-compatible `/audio/speech` engine instead of Perxona's voice: the avatar
session's `present` synthesizes server-side (`POST /api/tts`, rate-limited) and plays it via
`presentWithAudio`, falling back to Perxona speech on failure. The codec contract is verified
16 kHz mono PCM WAV — `TTS_NORMALIZE=1` (default) resamples whatever the engine emits via ffmpeg;
the produced format was checked end-to-end (fmt=1, 1ch, 16000 Hz, 16-bit). The English guide voice
stays on Perxona. The Phase 0 spike open item (BYO codec guarantees on real hardware) is resolved to
the extent possible without a hardware pass: the bytes handed to `presentWithAudio` are guaranteed
to match the codec the widget was verified to accept headless.

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

**Phase 4 deferred:** all three deferred items landed in Phase 5 — in-app camera QR scanning
(Phase 5a), settings persisted per scenario row (Phase 5c), and the `presentWithAudio` codec
contract normalized + verified (Phase 5f).

**Phase 5 — real camera QR scanning (this round):** the phone companion now scans the desktop
pairing QR in-app (`CameraScanner`): `getUserMedia` → hidden canvas → jsQR (lazy-loaded, so the
main bundle stays lean; jsqr ships in its own 47 KB-gzip chunk). The decoded payload (the full
`joinUrl` or a bare 6-char code) is normalized by `joinHashFromQr` in `src/lib/session-utils.ts`
and adopted as the join hash. Camera permission/not-found/not-readable errors surface inline. The
native-camera-app route still works as before.

**Phase 5 — per-role avatar packs (this round):** each role now has a curated
avatar/scene/voice `pack` in `src/shared/coaching.json` (ids verified live against the Connect
catalog): Reception → `cc007_female_hr` + Interior_1 + a steady female voice; Claims desk →
`cc039_female_legal` + Interior_2 + formal voice; Accounts → `cc006_male_finance` + Interior_3 + a
calm male voice. The scenario step seeds avatar/scene/voice from the selected role's pack (falling
back to the curated defaults when an id is missing from the catalog) and re-applies the pack when
the role changes, so persona, face, room and voice stay aligned.

**Phase 5 — scenario persistence (this round):** the `scenario` table gains `summary` /
`reference` / `answers` / `settings` / `selection` columns (idempotent `ALTER TABLE` for existing
DBs). REST: `POST/GET/PUT/DELETE /api/scenarios` (`server/scenarios.mjs`, user-scoped). The stage
saves a scenario at call start (script + glossary + coaching settings + grounding + avatar
selection) and attaches the cheat sheet when the call finishes. The setup screen renders a
`PastCalls` list (`src/components/setup/PastCalls.tsx`); tapping one restores the full call state
into the app store, relaunches the avatar with the stored selection (or the role's pack) and jumps
straight to the call — or the cheat sheet when one exists. Scenarios are JSON blobs scoped by
`userId`; ephemeral upload ids and Connect tokens are never stored.

**Phase 7b completed (this round):** the client→server migration — a background job runner
(`server/jobs.mjs`: lanes, deadlines, input-hash dedup), the step graph + run engine
(`server/graph.mjs`), the `confirmTarget` gate with speculative execution + confirm-the-guess dedup,
`planScenario`/`parseDocument`/`cheatSheet` migrated to server graph steps (the cheat sheet now
generates speculatively during the call), and the intent-message UI (`intent` carries `RunContext`
into `startRun`; `deliver` stamps `run.result` onto every `RunSnapshot`; `RunStatus` UI).

**Phase 7c completed (this round):** UI usability — chrome cleanup (setup stepper removed, an app
footer added, transcript reachable on mobile) and main-surface audio controls + chat cleanliness.

**Phase 7d completed (2026-08-25) — security & code-quality hardening**, driven by a repo-wide
review filed as 14 GitHub issues (jsaigou/TagTeam#1-14), all closed. Security: WS pairing-code
brute-force protection + role gating on state-mutating hub messages (§8, `server/hub.mjs`); an
SSRF guard on outbound scrape targets (`server/ssrf-guard.mjs`); magic-byte content checking on
uploads (`server/file-sniff.mjs`); shape validation added to `PUT /api/scenarios/:id` (previously
the only scenario write path that skipped it); a startup warning if the dev-only demo API is ever
enabled under `NODE_ENV=production`. Code quality: `server.mjs` (1000+ lines) split into
`server/connect-client.mjs`, `server/middleware.mjs`, and `server/routes/{catalog,media,search,
sessions}.mjs` — see the Architecture bullet in `AGENTS.md` for the module map and the new-route
convention; a shared rate-limiter registry (`server/rate-limit.mjs`) replaced 13 independent
`Map`/`setInterval` pairs. `SetupScreen.tsx` (1091 lines) and `CallScreen.tsx` (660 lines) were
god-components mixing chat/search/state-machine/mic-input logic with rendering — extracted into
`src/hooks/use-setup-chat.ts`, `use-call-mic-input.ts`, `use-call-ws-events.ts` and 5 standalone
sub-components (`SetupScreen.tsx` → ~400 lines, `CallScreen.tsx` → ~470). All 6 existing
`react-hooks/exhaustive-deps` suppressions were audited; 2 were genuine bugs relying on incidental
re-renders (fixed, not just silenced), 4 were legitimately unstable-identity context objects (left
as-is). Full detail: `docs/handoff-2026-08-25-review-hardening.md`.

## 12. Open questions

All four original questions were resolved on 2026-08-21 (post–slice-6 review):

- **Per-org vs shared Connect identity** — resolved: shared identity is the design. One
  sponsor-provided Connect account (env-held credentials; browsers only ever receive
  minted tokens) is correct for the event. Per-org credentials only become relevant if
  the product goes multi-tenant afterwards.
- **`presentWithAudio` on real hardware** — resolved: the codec guarantee is proven in
  code (Phase 5f normalizes BYO TTS to the exact 16 kHz mono WAV the widget accepted
  headless), and a local audible pass on 2026-08-21 confirmed Luna's guidance plays
  through physical speakers via the production build. Audibility on the *event phones*
  remains an event-day QA checklist item, not open engineering work.
- **Chatbot latency / 30 calls-per-min** — resolved: dormant opt-in. The deployed app
  runs the default `own-llm` brain; `NEXTTURN_PROVIDER=connect-chatbot` stays a
  documented showcase path. Capacity math: one session at normal cadence is ~2–3
  calls/min, so the 30/min cap only binds around ten concurrent active sessions
  sharing one chatbot.
- **OpenCV.js vendored vs CDN** — resolved: self-hosted. `public/vendor/opencv.js`
  (official 4.10.0 build) is the same-origin default; `VITE_OPENCV_URL` still overrides
  the host. docs.opencv.org turned out to sit behind bot protection (a bare HTTP fetch
  receives a challenge page instead of the library), which settled the question
  empirically. Fully-offline deployment remains out of scope — the presenter and LLM
  paths are network-bound by design.
