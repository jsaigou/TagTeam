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
| `VITE_LLM_BASE_URL` / `VITE_LLM_API_KEY` / `VITE_LLM_MODEL` | The OpenAI-compatible LLM used for document grounding, script generation, and cheat sheets |
| `VITE_PRESENTER_URL` | (optional) `<sv-presenter>` engine CDN; defaults to the asia channel |
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
       │
       └── <sv-presenter> renders the avatar directly against Connect with the minted token
```

- The Connect identity (`PERXONA_*`) never reaches the browser — `server.mjs` mints short-lived
  tokens via `GET /api/connect-token`.
- The LLM key ships to the browser as a `VITE_` var (demo tradeoff; move it server-side for
  production).

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Server exits at startup | Missing `PERXONA_API_BASE_URL` / `PERXONA_CONNECT_EMAIL` / `PERXONA_CONNECT_PASSWORD` |
| Avatar never appears | Check `VITE_PRESENTER_URL` is reachable; ensure Connect credentials mint a valid token (`curl http://localhost:8083/api/connect-token`) |
| "Search is not configured" | Set `SEARXNG_URL` (see §4a) |
| SearXNG returns errors | Confirm JSON output is enabled on the instance; try self-hosting |
| Firecrawl scrape fails | Confirm `FIRECRAWL_URL` + `FIRECRAWL_API_KEY`; self-hosted instances need Redis/Postgres/Playwright up |
| LLM calls fail | Check `VITE_LLM_API_KEY`/`VITE_LLM_BASE_URL`; the model must support `response_format: json_object` |
