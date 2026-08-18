# TagTeam — Phase 0: Perxona Spike Findings

Phase 0 was a research + spike pass to verify the current Perxona platform capabilities against
what the app assumes. The app's installed `@perxona/presenter-types@0.2.0` is current, but the app
uses only a small fraction of the presenter's surface, and several "unrealized" product ideas are
now first-class platform features.

The spike was run live against `https://console.perxona.ai/asia` (the configured region) using a
headless Chromium (SwiftShader) for the browser checks and the homelab SearXNG + Firecrawl
(`*.mango-rockhopper.ts.net`) for the search checks. Throwaway spike scripts live outside the repo
(under the system temp dir); only this findings note is kept.

## Confirmed capabilities

### Presenter SDK (`<sv-presenter>`), verified in a real browser

All checks passed against the `asia/prod` CDN runtime. `present()`/`presentWithAudio()` both
resolved with `code: "0"` (accepted).

| Capability | Status | Notes |
| --- | --- | --- |
| Engine loads from `https://cdn.perxona.ai/asia/prod/latest/widget/entry/presenter.js`, reaches `Ready` | ✅ | 100 KB module; WebGL via SwiftShader |
| `resumeAudioPlayback()` (gesture unlock) | ✅ | Resolves headless; autoplay policy can be relaxed in tests |
| `setListening(true/false)` / `setThinking(true/false)` | ✅ | State hierarchy works; powers "listen/think" UX for the real-conversation loop |
| `present(text, { emotion, intensity })` | ✅ | Accepted; emotion/intensity drive facial-expression selection **inside the widget** |
| `presentWithAudio(wavBuffer, text)` | ✅ | **BYO TTS works** — kokoro/qwen audio can be played on the avatar |
| `muteAudio(bool)` / `updateCameraAngle(fullbody\|halfbody)` | ✅ | |
| `interruptPresentation()` | ✅ | |

`asia/prod` and `prod` CDN channels serve byte-identical runtimes (100 KB, same feature surface).

### Connect API

| Capability | Status | Notes |
| --- | --- | --- |
| Login → bearer token | ✅ | 279-char JWT; works with the app's env |
| Avatar catalog + per-avatar **motion catalog** | ✅ | Guide avatar `cc051_meeks` has 8 motions incl. the hardcoded wave `01KD2H5BX9MXDJA5T9QY83QYS3`; practice avatar `cc066_male_waiter` has 5 (bow, *thinking*, talk…). Motions are per-avatar — do not reuse across avatars |
| `POST /presentation` (server payload builder) | ✅ | With a `voice_id` it returns real SSML (`speech_format: ssml`); **without** `voice_id` it's BYO-TTS mode (`speech_content: null`, `speech_format: unknown`). `performance_manifest` comes back **empty** from the raw endpoint — motion/facial selection happens widget-side, so emotion/intensity must be tested in a browser |
| `POST /chatbots` + `/chatbots/:id/chat` | ✅ | Create/chat/delete verified. Japanese turn returned natural keigo: `こんにちは！お問い合わせありがとうございます。来週の水曜日ですね、確認いたします。…`. Message format is Connect-specific (`{ role, parts: [{ type: "text", text }] }`), not OpenAI |
| Voice catalog with `language=ja` filter | ✅ | Voices are Azure multilingual neural voices (e.g. the JP "Male - warm and expressive" maps to `fr-FR-RemyMultilingualNeural`, `xml:lang=ja-JP`) |
| Rate limits (from `openapi.yaml`) | ℹ️ | login 5/s · presentation 10/s · voices 30/s · chatbot create 5/min · chatbot chat 30/min |

## Geolocation-scoped research (the target-specific scenario requirement)

The concern — surfacing wrong-country offices for a same-named clinic — is real and now measured:

- **Bare ambiguous name** ("Sunrise Dental Clinic") → Canadian/US results (`sunrisedentalclinic.ca`, `sunrisedental.com`).
- **Same query + `language=ja-JP`** → Japan results (`Sunrise Dental Clinic Hiroo Tokyo`), one Cairo outlier remains.
- **Japanese name + city** ("渋谷デンタルクリニック 東京都") → the specific clinic's homepage + listing pages (mynavi, qlife, medicalist) — exactly the booking-relevant pages we want.
- **Firecrawl scrape** of a listing page produced clean, structured Japanese markdown (address, phone, hours incl. "19時以降診療", departments, official name) — ideal input for an `extractTargetRules` step.

Conclusion: pass `language=ja-JP` (and append location terms) to SearXNG, then **always surface the located target + extracted rules for user confirmation**. Search stays on TagTeam's server — Connect function tools are SSRF-protected to public IPs, so they cannot reach Tailscale/private homelab services.

## Chatbot vs own-LLM (the "bureaucrat brain")

The hybrid decision is structurally forced, not a preference:

- **Multimodal doc parsing + search synthesis must be own-LLM.** The chatbot `parts` type is
  `text`-only (no image input), and its tools can't reach private IPs.
- **Conversational turns may use either.** The Connect Chatbot is a credible, managed option
  (verified above) — a strong sponsor showcase — but is Gemini-backed, non-streaming, and
  text-only. Own-LLM (the app's existing OpenAI-compatible pipeline, BYOK) keeps full control.

Both sit behind one `nextTurn` interface; the plan treats the Connect Chatbot as the showcase path
and own-LLM as the default/fallback.

## Implications for the plan

1. **Upgrade the presenter layer to the full surface.** `use-presenter.ts` currently drops
   `PresentOptions` (`present(content)` only) and never calls `setListening/setThinking`,
   `presentWithAudio`, `muteAudio`, or `updateCameraAngle`. All are live in the pinned types.
2. **Emotion/intensity per turn** is a near-free, high-visibility feature: extend the sim engine's
   JSON schema with `emotion`/`intensity`, pass through `present(text, { emotion, intensity })`.
3. **BYO TTS is real.** `presentWithAudio` works — kokoro/qwen (and any other TTS) can be a
   provider option while Perxona voices stay the default.
4. **Motion catalog, not hardcoded IDs.** Enumerate motions per avatar and validate any
   `[MOTION …]` markup / `playMotion` calls against the real catalog (the reference sample's
   `demo-script` route already implements this pattern server-side). The hardcoded guide wave ID
   still resolves; do not reuse guide motions on practice avatars.
5. **Reference research becomes target-specific and geo-scoped.** Add `language=ja-JP` (+ location
   terms) to SearXNG, geolocate from the mailing address / user confirmation, scrape the located
   office's pages, extract `TargetProfile` rules with citations, and confirm with the user.
6. **CDN channel is safe to keep.** `asia/prod` is current (identical to `prod`).

## Open items (not resolvable from static analysis)

- Whether `presentWithAudio`'s audio pipeline accepts arbitrary codecs/rates in production
  hardware, or only the formats the Connect speech backend emits. (A generated 16 kHz mono WAV was
  accepted by the widget; audibility was not verifiable headless.)
- Per-org vs shared Connect identity for the marketing event — confirm with Perxona.
- Chatbot chat latency under real-conversation cadence (30 calls/min limit).
