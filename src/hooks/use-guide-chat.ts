import { useCallback, useEffect, useRef, useState } from "react";
import { useVoiceTalk, type VoiceTalkResult } from "@/hooks/use-voice-talk";
import { transcribeAudio } from "@/lib/session-api";
import { chat, type ChatMessage } from "@/lib/llm";

export type GuideChatState = "idle" | "listening" | "thinking" | "error";

export type GuideChatOptions = {
  /** Show + speak Luna's reply (wire to `speakGuide`). */
  onReply: (reply: string) => void;
  /** Mirror the LLM "thinking" phase on the avatar. */
  onThinkingChange?: (thinking: boolean) => void;
  /** The user's transcribed speech (for the persistent chat transcript). */
  onUserInput?: (text: string) => void;
  /** Build the full LLM message list for a transcript (persona + context). */
  buildContext: (transcript: string) => ChatMessage[];
  /** STT language override (default "en" — the guide speaks English). */
  language?: string;
  /** True while Luna's own voice is audibly playing (`session.isSpeaking`).
   *  Pauses capture so the VAD doesn't transcribe her own speech (echo
   *  guard); capture resumes automatically when she finishes. */
  avatarSpeaking?: boolean;
  /** Pre-roll audio kept before detected speech onset (ms), so the start of
   *  an utterance — e.g. a word barging in right as listening arms — is
   *  never clipped. */
  preRollMs?: number;
};

/** How long before speech onset the rolling buffer keeps audio. */
const DEFAULT_PRE_ROLL_MS = 700;

/**
 * Mic → Luna on the setup screen. The Talk BUTTON owns the mic: pressing it
 * starts a voice-activated (Silero VAD) session; speak and Luna submits
 * automatically when you pause — no second tap. Press again to stop. While a
 * session is active the mic keeps living across turns: it pauses during
 * STT/LLM processing and while Luna speaks (echo guard), then re-arms.
 */
export function useGuideChat(options: GuideChatOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const vad = useVoiceTalk();
  const [state, setState] = useState<GuideChatState>("idle");
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [voiceSession, setVoiceSession] = useState(false);
  /* Serialized turn queue: text sent while a turn is running is queued, not
     dropped — the homelab LLM legitimately takes 40–80s per reply, and
     silently eating everything typed during that window read as a dead send
     button. */
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  /* Shared LLM turn: build the guide context for `input` and hand the reply back. */
  const runTurn = useCallback(async (input: string) => {
    busyRef.current = true;
    setState("thinking");
    setError(null);
    optionsRef.current.onThinkingChange?.(true);
    try {
      const transcript = input.trim();
      if (!transcript) return;
      const messages = optionsRef.current.buildContext(transcript);
      const { content } = await chat(messages, { temperature: 0.4 });
      const reply = content.trim();
      if (reply) optionsRef.current.onReply(reply);
      setState("idle");
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "Sorry — I couldn't hear that. Please try again.",
      );
    } finally {
      busyRef.current = false;
      optionsRef.current.onThinkingChange?.(false);
    }
  }, []);

  /* Chain a turn onto the queue. runTurn handles its own errors, but the
     chain itself must never reject (that would poison every later turn). */
  const enqueueTurn = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    queueRef.current = queueRef.current
      .then(() => runTurn(trimmed))
      .catch(() => {});
  }, [runTurn]);

  /* STT → Luna turn. The queue serializes turns, so an utterance transcribed
     while a previous turn is still running waits its turn instead of being
     dropped. */
  const submitAudio = useCallback(
    async (audio: VoiceTalkResult) => {
      try {
        const { text } = await transcribeAudio({
          audioBase64: audio.audioBase64,
          mimeType: audio.mimeType,
          language: optionsRef.current.language ?? "en",
        });
        const trimmed = text.trim();
        if (trimmed) optionsRef.current.onUserInput?.(trimmed);
        enqueueTurn(text);
      } catch (err) {
        setState("error");
        setError(
          err instanceof Error ? err.message : "Sorry — I couldn't hear that. Please try again.",
        );
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* Talk button: press to open a voice-activated session, press again to stop.
     Safe even mid-turn — capture auto-pauses while turns run and queued
     utterances are handled in order. */
  const startVoice = useCallback(() => {
    setError(null);
    setVoiceSession(true);
    setState((s) => (s === "thinking" ? s : "listening"));
  }, []);

  const stopVoice = useCallback(() => {
    setVoiceSession(false);
    if (!busyRef.current) setState("idle");
  }, []);

  /* Capture runs only while the session is open AND it's the user's turn:
     paused during STT/LLM processing and while Luna is speaking (echo
     guard), automatically re-armed when both clear. */
  const captureActive =
    voiceSession && !busyRef.current && !(options.avatarSpeaking ?? false);

  useEffect(() => {
    if (!captureActive) {
      void vad.stop();
      return;
    }
    void vad.start({
      preRollMs: options.preRollMs ?? DEFAULT_PRE_ROLL_MS,
      onUtterance: (audio) => void submitAudio(audio),
    });
    return () => {
      void vad.stop();
    };
    /* Deps deliberately use the stable functions, not the `vad` context
       object, which changes identity every render (same pattern as the
       in-call VAD window in CallScreen.tsx). */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureActive, vad.start, vad.stop, submitAudio]);

  const sendText = useCallback(
    (text: string) => {
      enqueueTurn(text);
    },
    [enqueueTurn],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    supported: vad.supported,
    state,
    error,
    /** True while the Talk-button voice session is open (mic may be briefly
     *  paused by the echo guard / processing — the UI should still read as
     *  "in talk mode"). */
    voiceSessionActive: voiceSession,
    startVoice,
    stopVoice,
    sendText,
    clearError,
  };
}
