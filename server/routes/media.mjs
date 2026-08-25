/** Speech (STT/TTS/audio-upload) + LLM-proxy routes. */
import express from "express";
import { requireAuth, route } from "../middleware.mjs";
import { rateLimit } from "../rate-limit.mjs";

/** @param {{ llmChat: Function, transcribeAudio: Function, synthesizeSpeech: Function, uploadStore: object }} deps */
export function createMediaRoutes({ llmChat, transcribeAudio, synthesizeSpeech, uploadStore }) {
  const router = express.Router();

  // LLM proxy — the browser posts OpenAI-compatible chat completions here
  // (same-origin, no CORS); the key/base URL stay server-side.
  router.post(
    "/api/llm",
    requireAuth,
    route(async (req, res) => {
      const { model, messages, temperature, response_format, max_tokens } = req.body ?? {};
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Missing messages" });
        return;
      }
      try {
        const payload = await llmChat(messages, {
          model: typeof model === "string" && model ? model : undefined,
          temperature: typeof temperature === "number" ? temperature : 0.2,
          responseFormat: response_format,
          maxTokens: typeof max_tokens === "number" ? max_tokens : 8192,
        });
        res.json(payload);
      } catch (err) {
        res.status(err.status ?? 502).json(err.payload ?? { error: String(err) });
      }
    }),
  );

  // The browser captures 16 kHz mono WAV (see src/lib/push-to-talk.ts) and
  // POSTs it here as base64 JSON — the STT key/binary stay server-side.
  // whisper.cpp is the default backend; STT_PROVIDER=hosted switches to an
  // OpenAI-compatible `/audio/transcriptions` endpoint.
  router.post(
    "/api/stt",
    requireAuth,
    rateLimit("stt", { windowMs: 60_000, max: 20 }),
    express.json({ limit: "15mb" }),
    route(async (req, res) => {
      const { audio_base64, mime_type, language } = req.body ?? {};
      if (typeof audio_base64 !== "string" || !audio_base64) {
        res.status(400).json({ error: "'audio_base64' is required." });
        return;
      }
      const buffer = Buffer.from(audio_base64, "base64");
      if (buffer.length === 0) {
        res.status(400).json({ error: "Empty audio." });
        return;
      }
      const result = await transcribeAudio(buffer, {
        mimeType: typeof mime_type === "string" ? mime_type : "audio/wav",
        language: typeof language === "string" ? language : undefined,
      });
      res.json(result);
    }),
  );

  // BYO TTS (Phase 5f) — synthesize speech server-side (kokoro/qwen or any
  // OpenAI-compatible /audio/speech) and return a 16 kHz mono WAV the
  // avatar's presentWithAudio can play. Requires TTS_PROVIDER=byo.
  router.post(
    "/api/tts",
    requireAuth,
    rateLimit("tts", { windowMs: 60_000, max: 30 }),
    express.json({ limit: "1mb" }),
    route(async (req, res) => {
      const { text, language } = req.body ?? {};
      if (typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "'text' is required." });
        return;
      }
      const audio = await synthesizeSpeech(text, {
        language: typeof language === "string" ? language : undefined,
      });
      res.set({
        "Content-Type": "audio/wav",
        "Content-Length": audio.length,
        "Cache-Control": "no-store",
      });
      res.end(audio);
    }),
  );

  // Push-to-talk bytes go through the same ephemeral store as scanned pages:
  // POST once, then announce the store reference over the WS hub (`audio`
  // message).
  router.post(
    "/api/audio",
    requireAuth,
    rateLimit("audio", { windowMs: 60_000, max: 30 }),
    express.json({ limit: "15mb" }),
    route(async (req, res) => {
      const { audio_base64, mime_type, sessionId } = req.body ?? {};
      if (typeof audio_base64 !== "string" || !audio_base64) {
        res.status(400).json({ error: "'audio_base64' is required." });
        return;
      }
      const buffer = Buffer.from(audio_base64, "base64");
      if (buffer.length === 0) {
        res.status(400).json({ error: "Empty audio." });
        return;
      }
      const record = uploadStore.create({
        filename: `audio-${Date.now()}.wav`,
        mimeType: typeof mime_type === "string" ? mime_type : "audio/wav",
        buffer,
        sessionId: typeof sessionId === "string" ? sessionId : undefined,
      });
      res.json(record);
    }),
  );

  return router;
}
