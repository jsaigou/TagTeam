/**
 * Phase 3 — server-side call orchestrator.
 *
 * Holds the per-session conversation state (scenario context + running
 * transcript) in memory and executes the `audio → stt → nextTurn → turn`
 * pipeline. The stage seeds the context once at call start; then ANY device
 * (desktop mic or phone companion) pushes push-to-talk audio over the WS hub
 * (`{ type: "audio", audioId }`) and the orchestrator replies with the
 * bureaucrat's adaptive next turn.
 *
 * Context + transcript are keyed by app_session id and are independent of WS
 * connections, so a reconnecting device keeps the conversation. Cleared when
 * the session room empties (hub) or via TTL.
 */
import crypto from "node:crypto";
import { isCallSettings } from "./coaching.mjs";
import { buildNextTurnMessages, isNextTurnResult } from "./next-turn.mjs";

/** Tolerate ```json ... ``` fences some models wrap their JSON in. */
function stripJsonFence(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

export const CALL_STATE_TTL_MS = 4 * 60 * 60 * 1000;

// Overall budget for the whole nextTurn retry loop (both attempts combined).
// Previously each attempt had its own 120s cap with nothing bounding the
// pair, so a persistently-malformed-but-slow reply could hold a session's
// `inFlight` flag for up to 240s. This is real cancellation (an AbortSignal
// threaded into llmChat), not a client-side guess — the deployed homelab LLM
// legitimately takes 40-80s per call (see AGENTS.md), so this must stay well
// above that.
export const NEXT_TURN_DEADLINE_MS = 150_000;

/** Keep only vocab ids that actually exist in the glossary (defensive). */
function safeVocab(ids, glossary) {
  if (!Array.isArray(ids)) return [];
  const known = new Set((glossary ?? []).map((g) => g.id));
  return ids.filter((id) => typeof id === "string" && known.has(id));
}

/**
 * @param {object} deps
 * @param {import("./providers.mjs").transcribeAudio} deps.transcribeAudio
 * @param {import("./providers.mjs").llmChat} deps.llmChat
 */
export function createCallOrchestrator({ transcribeAudio, llmChat }) {
  const sessions = new Map();

  function getSession(sessionId) {
    let s = sessions.get(sessionId);
    if (s && Date.now() > s.expiresAt) {
      sessions.delete(sessionId);
      s = null;
    }
    if (!s) {
      s = { context: null, transcript: [], inFlight: false, expiresAt: 0 };
      sessions.set(sessionId, s);
    }
    return s;
  }

  function clear(sessionId) {
    sessions.delete(sessionId);
  }

  /**
   * Seed the conversation context (called by the stage at call start).
   * Resets the transcript, pre-seeding the first scripted bureaucrat turn
   * (the player always opens with it).
   */
  function setContext(sessionId, context) {
    const s = getSession(sessionId);
    s.context = {
      script: context?.script ?? null,
      glossary: Array.isArray(context?.glossary) ? context.glossary : [],
      summary: typeof context?.summary === "string" ? context.summary : undefined,
      answers: Array.isArray(context?.answers) ? context.answers : undefined,
      reference: typeof context?.reference === "string" ? context.reference : undefined,
      settings: isCallSettings(context?.settings) ? context.settings : undefined,
    };
    const first = s.context.script?.turns?.[0];
    s.transcript = first && first.speaker === "bureaucrat" ? [first] : [];
    s.inFlight = false;
    s.expiresAt = Date.now() + CALL_STATE_TTL_MS;
    return { transcript: s.transcript };
  }

  /** Running conversation transcript (for tests / diagnostics). */
  function getTranscript(sessionId) {
    return getSession(sessionId).transcript;
  }

  /**
   * Run STT + nextTurn on a push-to-talk audio buffer. Appends the transcribed
   * user turn and the generated bureaucrat reply to the session transcript.
   */
  async function handleAudio(sessionId, { buffer, mimeType, language }) {
    const s = getSession(sessionId);
    if (!s.context?.script) {
      throw Object.assign(
        new Error("This call has no scenario — restart the call from the desktop."),
        { status: 409 },
      );
    }
    if (s.inFlight) {
      throw Object.assign(new Error("The office is still replying — please wait a moment."), {
        status: 409,
      });
    }
    s.inFlight = true;
    try {
      const { text } = await transcribeAudio(buffer, { mimeType, language });
      if (!text) {
        throw Object.assign(new Error("I couldn't make out what you said — please try again."), {
          status: 422,
        });
      }
      const userTurn = {
        id: `u${crypto.randomUUID().slice(0, 8)}`,
        speaker: "user",
        jp: text,
        vocab: [],
      };
      s.transcript.push(userTurn);
      s.expiresAt = Date.now() + CALL_STATE_TTL_MS;

      // Retry once on a malformed reply, then surface (architecture §5).
      // Both attempts share one overall deadline — a real AbortSignal, not a
      // client-side guess — so a slow-but-alive model gets its full
      // NEXT_TURN_DEADLINE_MS combined, never twice that.
      const deadline = new AbortController();
      const deadlineTimer = setTimeout(() => deadline.abort(), NEXT_TURN_DEADLINE_MS);
      let reply;
      let timedOut = false;
      try {
        for (let attempt = 0; attempt < 2 && !deadline.signal.aborted; attempt++) {
          let generated;
          try {
            generated = await generateNextTurn(s.context, s.transcript, { signal: deadline.signal });
          } catch (err) {
            if (deadline.signal.aborted) {
              timedOut = true;
              break;
            }
            throw err;
          }
          if (generated) {
            reply = generated;
            break;
          }
        }
      } finally {
        clearTimeout(deadlineTimer);
      }
      if (timedOut) {
        throw Object.assign(
          new Error("The office is taking a long time to reply — please try again."),
          { status: 504 },
        );
      }
      if (!reply) {
        throw Object.assign(
          new Error("The office didn't respond properly — please try again."),
          { status: 502 },
        );
      }

      s.transcript.push(reply.turn);
      return { userTurn, replyTurn: reply.turn, end: reply.done === true };
    } finally {
      s.inFlight = false;
    }
  }

  /** One LLM call for the next turn; null when the reply failed validation. */
  async function generateNextTurn(context, transcript, { signal } = {}) {
    const messages = buildNextTurnMessages(context, transcript);
    const payload = await llmChat(messages, {
      temperature: 0.6,
      // Generous budget: reasoning models (e.g. gemma4-26b-a4b-nothink) burn tokens on
      // reasoning before emitting `content` — a tight cap returns empty text.
      maxTokens: 8192,
      responseFormat: { type: "json_object" },
      signal,
    });
    const rawText = payload.choices?.[0]?.message?.content;
    let parsed;
    try {
      parsed = JSON.parse(stripJsonFence(String(rawText ?? "")));
    } catch {
      parsed = null;
    }
    if (!isNextTurnResult(parsed)) {
      console.error(`[orchestrator] nextTurn invalid (len=${rawText?.length ?? 0}):`, (rawText ?? "").slice(0, 400));
      return null;
    }
    const replyJp = typeof parsed.jp === "string" ? parsed.jp : parsed.text;
    return {
      done: parsed.done === true,
      turn: {
        id: `r${crypto.randomUUID().slice(0, 8)}`,
        speaker: "bureaucrat",
        jp: replyJp,
        ...(parsed.en ? { en: parsed.en } : {}),
        vocab: safeVocab(parsed.vocab, context.glossary),
        ...(parsed.emotion ? { emotion: parsed.emotion } : {}),
        ...(parsed.intensity ? { intensity: parsed.intensity } : {}),
      },
    };
  }

  return { setContext, handleAudio, clear, getTranscript };
}
