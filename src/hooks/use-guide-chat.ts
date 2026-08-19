import { useCallback, useEffect, useRef, useState } from "react";
import { usePushToTalk, type PushToTalkResult } from "@/hooks/use-push-to-talk";
import { useVoiceTalk } from "@/hooks/use-voice-talk";
import { useTalkMode } from "@/state/talk-mode-context";
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
   *  Gates voice-activated talk so it doesn't transcribe her own speech —
   *  same echo guard as the in-call VAD window (CallScreen.tsx). */
  avatarSpeaking?: boolean;
  /** Only run voice-activated talk while true (e.g. the setup panel is open).
   *  Defaults to true — pass false to keep VAD off on a pre-interaction
   *  screen even when the user's talk-mode preference is "vad". */
  voiceTalkEnabled?: boolean;
};

/**
 * Mic → Luna on the setup screen (Phase 6 follow-up). Captures speech with
 * either hold-to-talk (`usePushToTalk`) or, when the user's talk-mode
 * preference is "vad", hands-free Silero VAD (`useVoiceTalk`) — same choice
 * as the in-call mic. Either path transcribes via `/api/stt`, asks the LLM
 * (`/api/llm`) with the guide persona + current-setup context, and hands the
 * reply back to `onReply` for `speakGuide`. Self-contained — no orchestrator.
 */
export function useGuideChat(options: GuideChatOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const ptt = usePushToTalk();
  const vad = useVoiceTalk();
  const { talkMode } = useTalkMode();
  const [state, setState] = useState<GuideChatState>("idle");
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

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

  const start = useCallback(async () => {
    if (busyRef.current) return;
    setError(null);
    const recording = await ptt.start();
    setState(recording ? "listening" : "idle");
  }, [ptt]);

  const cancel = useCallback(() => {
    ptt.cancel();
    setState("idle");
  }, [ptt]);

  /* Shared by both capture paths: transcribe a finished clip, then run it as
     a Luna turn. Claims busyRef BEFORE the STT await, not just inside
     runTurn — otherwise there's a window (during transcribeAudio) where
     busyRef still reads false and a concurrent sendText()/VAD utterance can
     slip through and start a second turn, whose stale rejection later
     overwrites this one's error state. */
  const submitAudio = useCallback(
    async (audio: PushToTalkResult) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const { text } = await transcribeAudio({
          audioBase64: audio.audioBase64,
          mimeType: audio.mimeType,
          language: optionsRef.current.language ?? "en",
        });
        const trimmed = text.trim();
        if (trimmed) optionsRef.current.onUserInput?.(trimmed);
        // runTurn re-claims (already-true) busyRef and releases it in its
        // own `finally` — the claim above and this hand-off never leave a
        // gap because nothing awaits in between.
        await runTurn(text);
      } catch (err) {
        busyRef.current = false;
        setState("error");
        setError(
          err instanceof Error ? err.message : "Sorry — I couldn't hear that. Please try again.",
        );
      }
    },
    [runTurn],
  );

  const stop = useCallback(async () => {
    if (busyRef.current) return;
    const audio = await ptt.stop();
    if (!audio) {
      setState("idle");
      // Nothing usable was captured — either the tap released before the mic
      // finished arming, or the hold was shorter than MIN_RECORDING_MS.
      // Silently no-op'ing here is exactly what made "Talk to Luna" look
      // broken — say why nothing happened instead.
      setError("That was too quick — hold the mic a little longer.");
      return;
    }
    await submitAudio(audio);
  }, [ptt, submitAudio]);

  /* Voice-activated talk (Silero VAD), gated the same way as the in-call VAD
     window: only while it's the setup screen's turn to listen — talk mode is
     "vad", the caller says it's an OK time to listen, Luna isn't already
     replying, and Luna isn't currently speaking (echo guard). Push-to-talk
     stays wired regardless, same as the call screen keeps a PTT fallback. */
  const thinking = state === "thinking";
  const vadActive =
    talkMode === "vad" &&
    (options.voiceTalkEnabled ?? true) &&
    !thinking &&
    !options.avatarSpeaking;

  useEffect(() => {
    if (!vadActive) {
      void vad.stop();
      return;
    }
    void vad.start({ onUtterance: (audio) => void submitAudio(audio) });
    return () => {
      void vad.stop();
    };
    /* Deps deliberately use the stable functions, not the `vad` context
       object, which changes identity every render (same pattern as the
       in-call VAD window in CallScreen.tsx). */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vadActive, vad.start, vad.stop, submitAudio]);

  const sendText = useCallback(
    (text: string) => {
      if (busyRef.current) return;
      if (!text.trim()) return;
      void runTurn(text);
    },
    [runTurn],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    supported: ptt.supported,
    state,
    error,
    start,
    stop,
    cancel,
    sendText,
    clearError,
    /** True while talk mode is "vad" and the mic is hands-free-listening. */
    voiceTalkActive: vadActive && vad.state !== "error",
  };
}
