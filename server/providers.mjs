/**
 * Provider layer — every external capability is env-driven, so a homelab
 * (LLM, whisper.cpp, SearXNG, Firecrawl) is reusable AND a bare install works.
 * Phase 3 adds the STT provider behind the same pattern.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { accessSync } from "node:fs";
import fs from "node:fs/promises";
import crypto from "node:crypto";

export const config = {
  llm: {
    provider: (process.env.LLM_PROVIDER || "openai").toLowerCase(), // openai | anthropic
    baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
  },
  chatbot: {
    // nextTurn brain backend: "own-llm" (default) | "connect-chatbot" (Phase 5d).
    // The chatbot's custom_instructions hold the persona; the per-call
    // scenario/coaching context is sent as the message content.
    nextTurnProvider: (process.env.NEXTTURN_PROVIDER || "own-llm").toLowerCase(),
    chatbotId: process.env.CHATBOT_ID || "",
  },
  stt: {
    provider: (process.env.STT_PROVIDER || "whisper-cpp").toLowerCase(), // whisper-cpp | hosted
    whisperBin: process.env.WHISPER_BIN || "whisper-cli",
    whisperModel: process.env.WHISPER_MODEL || "ggml-base.bin",
    baseUrl: (process.env.STT_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    apiKey: process.env.STT_API_KEY || "",
    model: process.env.STT_MODEL || "whisper-1",
    language: process.env.STT_LANGUAGE || "ja",
  },
  tts: {
    // Avatar speech: "perxona" (default) | "byo" — generate audio server-side
    // and play it via presentWithAudio (kokoro/qwen or any OpenAI-compatible
    // /audio/speech). The widget's verified codec contract is 16 kHz mono WAV;
    // TTS_NORMALIZE (default on) resamples via ffmpeg to guarantee it.
    provider: (process.env.TTS_PROVIDER || "perxona").toLowerCase(),
    baseUrl: (process.env.TTS_BASE_URL || "").replace(/\/+$/, ""),
    apiKey: process.env.TTS_API_KEY || "",
    model: process.env.TTS_MODEL || "",
    voice: process.env.TTS_VOICE || "",
    language: process.env.TTS_LANGUAGE || "ja",
    normalize: (process.env.TTS_NORMALIZE || "1") !== "0",
  },
  search: {
    searxngUrl: (process.env.SEARXNG_URL || "").replace(/\/+$/, ""),
    // Geo-scoping: biases results to Japan so a bare office name doesn't
    // surface wrong-country businesses (see docs/phase0-spike.md).
    language: process.env.SEARCH_LANGUAGE || "ja-JP",
  },
  scrape: {
    firecrawlUrl: (process.env.FIRECRAWL_URL || "").replace(/\/+$/, ""),
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY || "",
  },
};

function sttNotConfigured() {
  const hint =
    config.stt.provider === "hosted"
      ? "Set STT_API_KEY (and STT_BASE_URL / STT_MODEL) in .env — see SETUP.md."
      : "Set WHISPER_BIN (and WHISPER_MODEL) in .env, or switch STT_PROVIDER=hosted — see SETUP.md.";
  throw Object.assign(new Error(`Speech-to-text is not configured. ${hint}`), { status: 501 });
}

/** Resolve the whisper model to an existing file path. Checks the value as
 *  given, then the common local dirs (models/, data/models/) so a bare model
 *  name like `ggml-base.bin` works after `curl`-ing it into `data/models/`. */
function resolveWhisperModel() {
  const candidates = [config.stt.whisperModel];
  if (!path.isAbsolute(config.stt.whisperModel) && !config.stt.whisperModel.includes("/")) {
    candidates.push(path.join("models", config.stt.whisperModel));
    candidates.push(path.join("data", "models", config.stt.whisperModel));
  }
  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      /* try next */
    }
  }
  return candidates[0];
}

/** Run whisper.cpp on the buffer and resolve with the joined transcription. */
function whisperCppTranscribe(buffer, { mimeType, language }) {
  return new Promise((resolve, reject) => {
    if (mimeType && mimeType !== "audio/wav" && mimeType !== "audio/x-wav") {
      reject(
        Object.assign(new Error(`whisper.cpp needs WAV audio (got ${mimeType}).`), { status: 415 }),
      );
      return;
    }
    const file = path.join(os.tmpdir(), `tagteam-stt-${crypto.randomUUID()}.wav`);
    fs.writeFile(file, buffer)
      .then(() => {
        const args = [
          "-m",
          resolveWhisperModel(),
          "-l",
          language || config.stt.language,
          "-nt",
          "-f",
          file,
        ];
        const child = spawn(config.stt.whisperBin, args, {
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("error", (err) => {
          reject(
            Object.assign(
              new Error(`Could not run ${config.stt.whisperBin}: ${err.message}`),
              { status: 501 },
            ),
          );
        });
        child.on("close", (code) => {
          fs.rm(file, { force: true }).catch(() => {});
          if (code !== 0) {
            reject(
              Object.assign(
                new Error(`whisper.cpp exited ${code}: ${stderr.trim().slice(0, 300)}`),
                { status: 502 },
              ),
            );
            return;
          }
          const text = stdout
            .split(/\r?\n/)
            .map((line) => line.replace(/^\s*\[[\d:.,\s-->]+\]\s*/, "").trim())
            .filter(Boolean)
            .join(" ");
          resolve({ text });
        });
      })
      .catch(reject);
  });
}

/** Hosted OpenAI-compatible transcription (`POST /audio/transcriptions`). */
async function hostedTranscribe(buffer, { mimeType, language }) {
  if (!config.stt.apiKey) sttNotConfigured();
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType || "audio/wav" }), "audio.wav");
  form.append("model", config.stt.model);
  form.append("language", language || config.stt.language);
  form.append("response_format", "json");
  const res = await fetch(`${config.stt.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.stt.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`STT request failed (${res.status})`), {
      status: 502,
      payload: { error: (detail || "STT upstream error").slice(0, 500) },
    });
  }
  const payload = await res.json();
  return { text: String(payload.text ?? "").trim() };
}

/**
 * Transcribe a raw audio buffer to Japanese text. Defaults to a whisper.cpp
 * subprocess; `STT_PROVIDER=hosted` switches to an OpenAI-compatible endpoint.
 * The buffer should be a 16 kHz mono WAV (see src/lib/push-to-talk.ts).
 */
export async function transcribeAudio(buffer, { mimeType, language } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw Object.assign(new Error("No audio data provided."), { status: 400 });
  }
  if (config.stt.provider === "hosted") {
    return hostedTranscribe(buffer, { mimeType, language });
  }
  return whisperCppTranscribe(buffer, { mimeType, language });
}

function openAiCompatibleResponse(payload) {
  if (config.llm.provider !== "anthropic") return payload;
  const text = payload.content
    ?.find?.((part) => part.type === "text")
    ?.text;
  return {
    choices: [{ message: { role: "assistant", content: text ?? "" } }],
  };
}

/**
 * OpenAI-compatible chat completion against the configured provider. Returns a
 * payload shaped like the OpenAI Chat Completions response.
 */
export async function llmChat(
  messages,
  { model, temperature = 0.2, responseFormat, maxTokens = 8192 } = {},
) {
  if (!config.llm.apiKey) {
    throw Object.assign(new Error("LLM is not configured. Set LLM_API_KEY (and LLM_BASE_URL / LLM_MODEL) in .env — see SETUP.md."), { status: 501 });
  }

  let url;
  let headers = { "Content-Type": "application/json" };
  let body;

  if (config.llm.provider === "anthropic") {
    url = `${config.llm.baseUrl}/messages`;
    headers["x-api-key"] = config.llm.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    body = {
      model: model || config.llm.model,
      max_tokens: maxTokens,
      messages: messages.filter((m) => m.role !== "system"),
      ...(system ? { system } : {}),
    };
    if (responseFormat) {
      body.output_config = { format: { type: "json_schema", schema: responseFormat.json_schema?.schema ?? responseFormat } };
    }
  } else {
    url = `${config.llm.baseUrl}/chat/completions`;
    headers.Authorization = `Bearer ${config.llm.apiKey}`;
    body = {
      model: model || config.llm.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (responseFormat) body.response_format = responseFormat;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`LLM request failed (${res.status})`), {
      status: 502,
      payload: { error: (detail || "LLM upstream error").slice(0, 500) },
    });
  }
  const payload = await res.json();
  return openAiCompatibleResponse(payload);
}

// ── BYO TTS (Phase 5f) ─────────────────────────────────────────────────────
// Generates speech server-side (OpenAI-compatible /audio/speech — kokoro,
// qwen, Edge TTS gateways…) and returns a 16 kHz mono WAV for the avatar's
// `presentWithAudio`. The Phase 0 spike verified that exact codec is accepted
// by the widget; normalization resamples whatever the engine emits via ffmpeg.

function ttsNotConfigured() {
  throw Object.assign(
    new Error(
      "BYO TTS is not configured. Set TTS_PROVIDER=byo with TTS_BASE_URL / TTS_API_KEY / TTS_MODEL (and optional TTS_VOICE) in .env — see SETUP.md.",
    ),
    { status: 501 },
  );
}

/** Resample any audio buffer to a 16 kHz mono PCM WAV via ffmpeg. */
function normalizeToWav16k(buffer) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-i", "pipe:0",
      "-f", "wav",
      "-acodec", "pcm_s16le",
      "-ar", "16000",
      "-ac", "1",
      "-y",
      "pipe:1",
    ], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      reject(
        Object.assign(
          new Error(
            `Could not run ffmpeg for BYO TTS normalization: ${err.message}. Install ffmpeg or set TTS_NORMALIZE=0.`,
          ),
          { status: 501 },
        ),
      );
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          Object.assign(
            new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 300)}`),
            { status: 502 },
          ),
        );
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(buffer);
  });
}

/**
 * Synthesize Japanese speech for the given text. Resolves with a 16 kHz mono
 * WAV buffer (normalized via ffmpeg when TTS_NORMALIZE is on).
 */
export async function synthesizeSpeech(text, { language } = {}) {
  if (config.tts.provider !== "byo") {
    throw Object.assign(
      new Error("BYO TTS is disabled. Set TTS_PROVIDER=byo to enable."),
      { status: 501 },
    );
  }
  if (!config.tts.baseUrl || !config.tts.apiKey || !config.tts.model) ttsNotConfigured();
  const res = await fetch(`${config.tts.baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.tts.apiKey}`,
    },
    body: JSON.stringify({
      model: config.tts.model,
      input: text,
      ...(config.tts.voice ? { voice: config.tts.voice } : {}),
      response_format: "wav",
      language: language || config.tts.language,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`TTS request failed (${res.status})`), {
      status: 502,
      payload: { error: (detail || "TTS upstream error").slice(0, 500) },
    });
  }
  const audio = Buffer.from(await res.arrayBuffer());
  if (!audio.length) {
    throw Object.assign(new Error("TTS returned empty audio."), { status: 502 });
  }
  return config.tts.normalize ? normalizeToWav16k(audio) : audio;
}
