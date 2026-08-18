# TagTeam — Setup Guide

A complete walkthrough for running TagTeam yourself: the Perxona Connect identity, the LLM, and
connecting your **own search + scraping** for the reference step.

> The reference-search feature ("Research the office") is optional and fully self-hosted. TagTeam
> never ships with a search backend — **you provide your own SearXNG and Firecrawl endpoints**, or
> skip the feature entirely. This guide covers all three options.

---

## 1. Prerequisites

- **Node.js ≥ 22** and **pnpm**
- A **Perxona Connect** account (email + password) — create one via the Connect Sign Up API
  (`POST /api/v1/connect/auth/signup` → email token → `POST /api/v1/connect/auth/confirm-signup`),
  not the general console sign-up.
- An **OpenAI-compatible LLM** endpoint + API key (any provider: OpenAI, Ollama, LM Studio, etc.).

## 2. Configure the environment

```bash
cp .env.example .env
```

Fill in the required values:

| Variable | Purpose |
| --- | --- |
| `PERXONA_API_BASE_URL` | Your Connect region, e.g. `https://console.perxona.ai/asia` |
| `PERXONA_CONNECT_EMAIL` / `PERXONA_CONNECT_PASSWORD` | The one shared Connect identity used to mint tokens for all visitors |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | The OpenAI-compatible LLM used for document grounding, script generation, and cheat sheets — **server-side**, proxied via `/api/llm` so the key never reaches the browser |
| `VITE_LLM_MODEL` | (optional) Model id sent by the client to the `/api/llm` proxy; overrides `LLM_MODEL` |
| `VITE_PRESENTER_URL` | (optional) `<sv-presenter>` engine CDN; defaults to the asia channel |
| `WHISPER_BIN` / `WHISPER_MODEL` | (Phase 3, optional) whisper.cpp CLI + model for push-to-talk; see [§5b](#5b-push-to-talk--real-conversation-phase-3) |
| `STT_PROVIDER` / `STT_BASE_URL` / `STT_API_KEY` / `STT_MODEL` | (Phase 3, optional) hosted STT alternative to whisper.cpp |
| `SEARXNG_URL` / `FIRECRAWL_URL` / `FIRECRAWL_API_KEY` | (optional) your search + scrape endpoints — see [§4](#4-connect-your-own-search) |

`.env` is git-ignored — never commit it.

## 3. Install and run

```bash
pnpm install
pnpm dev        # API on :8083, web app on :5173
```

Open **http://localhost:5173**. Production: `pnpm build && pnpm start`.

Verification: `pnpm build && pnpm lint && pnpm test`.

## 4. Connect your own search

The **"Research the office"** step in setup searches the web for the office/agency you'll call and
feeds the results into the simulation. It is powered by two services that **you** provide:

- **SearXNG** — a metasearch engine (aggregates Google/Bing/DuckDuckGo/etc.). TagTeam calls its
  JSON API to get top results.
- **Firecrawl** — a page-scraper that turns a URL into clean Markdown. TagTeam scrapes the top 2
  results so the LLM reads actual office pages.

Both are optional. **Leave `SEARXNG_URL` empty to disable search** — the app runs fine without it
(the setup step just won't offer research). To enable it, you need a SearXNG instance and
(preferably) a Firecrawl instance.

### 4a. SearXNG (required for search)

Provide any SearXNG instance that exposes the **JSON API**:

```
GET {SEARXNG_URL}/search?q=<query>&format=json
```

**Option A — self-host (recommended):** run SearXNG with Docker:

```bash
docker run -d --name searxng -p 8080:8080 \
  -e "SEARXNG_BASE_URL=http://localhost:8080/" \
  searxng/searxng
```

Then set `SEARXNG_URL=http://localhost:8080`.

**Option B — any existing/public instance:** point `SEARXNG_URL` at it. Note: JSON output may be
disabled by the operator; if you get an error, use your own instance.

Verify SearXNG works:

```bash
curl "http://localhost:8080/search?q=test&format=json" | head -c 200
```

### 4b. Firecrawl (recommended, for page content)

TagTeam calls Firecrawl's scrape endpoint:

```
POST {FIRECRAWL_URL}/v1/scrape
{ "url": "https://...", "formats": ["markdown"] }
```

**Option A — self-host:** Firecrawl publishes a Docker Compose stack
([mendableai/firecrawl](https://github.com/mendableai/firecrawl)). It needs Redis, PostgreSQL and
a Playwright service. After it's up, set `FIRECRAWL_URL` to its API origin (e.g.
`http://localhost:3002`). Self-hosted instances usually run **without** an API key.

**Option B — Firecrawl cloud:** use the hosted API at `https://api.firecrawl.dev`, and set:

```
FIRECRAWL_URL=https://api.firecrawl.dev
FIRECRAWL_API_KEY=fc-xxxxx        # from the Firecrawl dashboard
```

**Skip scraping:** if you only have SearXNG, leave `FIRECRAWL_URL` empty — search results are still
returned (without full page content), and the digest notes scraping is off.

### 4c. Verify end-to-end

```bash
# with the dev server running (API on :8083)
curl "http://localhost:8083/api/search?q=%E6%B8%8B%E8%B0%B7%E5%8C%BA%E5%BD%B9%E6%89%80%20%E4%BF%9D%E9%99%BA%E5%B9%B4%E9%87%91%E8%AA%B2"
```

A `200` with `{ query, results, digest }` means search is wired up. A `501` with
`"Search is not configured…"` means `SEARXNG_URL` is empty.

## 5. How it all fits together

```
Browser (React)  ──/api/connect-token──▶  server.mjs  ──login──▶  Perxona Connect API
       │                                     │
       │  /api/avatars · /api/scenes · /api/voices   (token minted per visitor)
       │                                     │
       │  /api/search ──▶  SearXNG (search) + Firecrawl (scrape)   ◀── yours
       │                                     │
       └── <sv-presenter> renders the avatar directly against Connect with the minted token
```

- The Connect identity (`PERXONA_*`) never reaches the browser — `server.mjs` mints short-lived
  tokens via `GET /api/connect-token`.
- The LLM is proxied through `POST /api/llm` (server-side `LLM_*` env) — the browser never holds
  the API key.

## 5a. Phone companion (Phase 2)

A second device (phone) can join the desktop session as a **camera + control surface**:

1. On the desktop, open **Set up your call** → the **Phone companion** panel shows a QR code
   (and a 6-character pairing code) for the current session.
2. On the phone, scan the QR with the phone's camera app (it opens the join URL) — or open the
   app and type the code manually.
3. The phone joins as a companion: it can **scan document pages** (pushed to the desktop's
   document bundle) and send **Hold / Resume / Tap-help** during the call.

How it works:

- A WebSocket session hub runs on the server (`ws://<host>/api/ws`, `server/hub.mjs`). The
  desktop is the `stage` device (owns the avatar + script player); phones join as `input` +
  `control`. The stage is exclusive — a second device requesting `stage` is downgraded.
- Pairing: `POST /api/sessions` mints a session + expiring pairing code (15 min); `join` is
  validated against it. Rotate with **New code** in the panel.
- Uploaded pages go to an **ephemeral in-memory store** (10-min TTL, `POST /api/uploads`), are
  relayed to the desktop over the hub, and are **deleted when the desktop acks** them. Nothing
  is written to the database.
- The hub broadcasts an `AppSnapshot` (screen, setup step, script title, player state, active
  turn) so the phone mirrors the desktop live. In Phase 3 the phone can also **speak into the
  call** (hold-to-talk → server brain → the desktop plays the office's reply).

Dev notes:

- In local dev the join URL uses whatever host you reach the app on. A physical phone on your
  LAN needs a LAN-reachable address (e.g. `http://192.168.x.x:5173`, or a Tailscale hostname) —
  `localhost` will not reach your phone.
- OpenCV.js (document edge-detect + crop) loads lazily from `VITE_OPENCV_URL` (default
  docs.opencv.org) on first scan; set it to a vendored copy for offline use. If it can't load,
  scans fall back to the un-cropped frame.

## 5b. Push-to-talk & real conversation (Phase 3)

At each user turn you can **hold to speak** instead of reading the scripted line. The mic audio is
transcribed to Japanese (whisper.cpp), the server's adaptive `nextTurn` brain generates the office's
reply, and the avatar speaks it back. This works from the desktop and from the phone companion.

Speech-to-text needs one backend (server-side, never in the browser):

**Option A — whisper.cpp (default):** `brew install whisper-cpp` puts `whisper-cli` on PATH, then
download the multilingual model once (whisper.cpp does **not** auto-download):

```bash
mkdir -p data/models
curl -L -o data/models/ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

`data/` is git-ignored, so the model stays local. `WHISPER_BIN` defaults to `whisper-cli`;
`WHISPER_MODEL` resolves `ggml-base.bin` under `models/` or `data/models/`. Use a bigger model
(`ggml-small.bin`, `ggml-medium.bin`) for better Japanese accuracy on a capable machine.

**Option B — hosted OpenAI-compatible transcription:**

```
STT_PROVIDER=hosted
STT_BASE_URL=https://api.openai.com/v1
STT_API_KEY=sk-...
STT_MODEL=whisper-1
```

How the conversation works:

- The browser records **raw PCM** (no MediaRecorder/webm — whisper.cpp reads WAV natively), downsamples
  to 16 kHz mono and WAV-encodes it (`src/lib/audio-utils.ts`).
- The WAV is POSTed to `/api/audio` (the same ephemeral 10-min store as scanned pages), then announced
  over the hub as an `audio` message. The server runs `audio → stt → nextTurn → turn` and broadcasts
  the transcribed user line + the generated reply to every device (`server/orchestrator.mjs`).
- The avatar shows `setListening` while you hold the button and `setThinking` while the brain works.
- No STT configured? The call still runs in **scripted mode** — the "Skip & continue" button advances
  the script instead of waiting for speech.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Server exits at startup | Missing `PERXONA_API_BASE_URL` / `PERXONA_CONNECT_EMAIL` / `PERXONA_CONNECT_PASSWORD` |
| Avatar never appears | Check `VITE_PRESENTER_URL` is reachable; ensure Connect credentials mint a valid token (`curl http://localhost:8083/api/connect-token`) |
| "Search is not configured" | Set `SEARXNG_URL` (see §4a) |
| SearXNG returns errors | Confirm JSON output is enabled on the instance; try self-hosting |
| Firecrawl scrape fails | Confirm `FIRECRAWL_URL` + `FIRECRAWL_API_KEY`; self-hosted instances need Redis/Postgres/Playwright up |
| LLM calls fail | Check `LLM_API_KEY`/`LLM_BASE_URL`; the model must support `response_format: json_object` |
| "Hold to speak" says microphone denied | Allow mic access in the browser (the request only fires while holding) |
| Push-to-talk upload fails | Check the server is reachable (`/api/audio`); the 8 MB ephemeral-store cap is plenty for 16 kHz WAV |
| STT error from whisper.cpp | `WHISPER_BIN` not on PATH or `WHISPER_MODEL` missing — download it into `data/models/` (see §5b) |
| "The office is still replying" | The brain is mid-generation; wait a moment before holding again |
| Phone shows "invalid or expired" pairing code | The 15-min code expired or the desktop rotated it — generate a **New code** and re-scan |
| Phone companion panel stays "Connecting…" | The browser must reach `/api/ws` — check the Vite proxy (`/api/ws` → ws://localhost:8083) or Tailscale route |
