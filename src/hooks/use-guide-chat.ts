import { useCallback, useRef, useState } from "react";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
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
};

/**
 * Mic → Luna on the setup screen (Phase 6 follow-up). Captures a hold-to-talk
 * clip with `usePushToTalk`, transcribes it via `/api/stt`, asks the LLM
 * (`/api/llm`) with the guide persona + current-setup context, and hands the
 * reply back to `onReply` for `speakGuide`. Self-contained — no orchestrator.
 */
export function useGuideChat(options: GuideChatOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const ptt = usePushToTalk();
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

  const stop = useCallback(async () => {
    if (busyRef.current) return;
    const audio = await ptt.stop();
    if (!audio) {
      setState("idle");
      return;
    }
    try {
      const { text } = await transcribeAudio({
        audioBase64: audio.audioBase64,
        mimeType: audio.mimeType,
        language: optionsRef.current.language ?? "en",
      });
      const trimmed = text.trim();
      if (trimmed) optionsRef.current.onUserInput?.(trimmed);
      await runTurn(text);
    } catch (err) {
      setState("error");
      setError(
        err instanceof Error ? err.message : "Sorry — I couldn't hear that. Please try again.",
      );
    }
  }, [ptt, runTurn]);

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
  };
}
