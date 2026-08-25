import { useCallback, useEffect, useRef, useState } from "react";
import { usePushToTalk, type PushToTalkResult } from "@/hooks/use-push-to-talk";
import { useVoiceTalk } from "@/hooks/use-voice-talk";
import type { TalkMode } from "@/state/talk-mode-context";

/* §7c.5 — the mic accepts BOTH press-and-hold (phones) and click-to-toggle
   + the Space hotkey (desktop): a release under CLICK_TOGGLE_MS latches the
   mic on instead of stopping it, and the next click/Space releases. Holds
   past the threshold behave exactly as before. */
const CLICK_TOGGLE_MS = 280;

export type UseCallMicInputOptions = {
  talkMode: TalkMode;
  /** The user's turn is showing and the call hasn't ended — the mic (hold or
   *  VAD) is available at all. */
  active: boolean;
  /** Further gates the VAD auto-listen window: the call has started and the
   *  brain isn't already replying. */
  vadReady: boolean;
  setListening: (listening: boolean) => void;
  setUserTurnActive: (active: boolean) => void;
  setConversationError: (error: string | null) => void;
  /** Shared by push-to-talk and voice-activated (VAD) paths — sends the
   *  captured utterance to the orchestrator. */
  onUtterance: (audio: PushToTalkResult) => void | Promise<void>;
};

/**
 * Owns the call screen's mic capture: push-to-talk (hold, or click-to-latch)
 * plus voice-activated (Silero VAD) talk, the Space-bar hotkey, and the
 * press/release/latch state machine. Extracted from CallScreen.tsx so that
 * component can stay focused on rendering.
 */
export function useCallMicInput({
  talkMode,
  active,
  vadReady,
  setListening,
  setUserTurnActive,
  setConversationError,
  onUtterance,
}: UseCallMicInputOptions) {
  const ptt = usePushToTalk();
  const vad = useVoiceTalk();

  const handlePTTDown = useCallback(async () => {
    if (ptt.state === "recording") return;
    setUserTurnActive(false);
    setConversationError(null);
    const recording = await ptt.start();
    if (recording) {
      setListening(true);
    } else {
      setUserTurnActive(true);
    }
  }, [ptt, setListening, setUserTurnActive, setConversationError]);

  const handlePTTUp = useCallback(async () => {
    if (ptt.state !== "recording") return;
    setListening(false);
    const audio = await ptt.stop();
    if (!audio) {
      setUserTurnActive(true);
      return;
    }
    await onUtterance(audio);
  }, [ptt, setListening, setUserTurnActive, onUtterance]);

  const micPressAtRef = useRef(0);
  const micLatchedRef = useRef(false);
  const [micLatched, setMicLatched] = useState(false);
  const setLatch = useCallback((value: boolean) => {
    setMicLatched(value);
    micLatchedRef.current = value;
  }, []);

  const handleMicPress = useCallback(() => {
    if (micLatchedRef.current) {
      setLatch(false);
      void handlePTTUp();
      return;
    }
    micPressAtRef.current = Date.now();
    void handlePTTDown();
  }, [handlePTTDown, handlePTTUp, setLatch]);

  const handleMicRelease = useCallback(() => {
    if (
      !micLatchedRef.current &&
      ptt.state === "recording" &&
      Date.now() - micPressAtRef.current < CLICK_TOGGLE_MS
    ) {
      setLatch(true); // a quick tap = click-to-start; keep recording
      return;
    }
    setLatch(false);
    void handlePTTUp();
  }, [handlePTTUp, ptt.state, setLatch]);

  /* Space mirrors the mic button — gated exactly like its render (user's turn,
     call not over), ignored while typing and on auto-repeat. */
  useEffect(() => {
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      target.closest("input, textarea, select, [contenteditable='true']");
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing(e.target) || !active) return;
      e.preventDefault();
      handleMicPress();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (typing(e.target) || !active) return;
      e.preventDefault();
      handleMicRelease();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [active, handleMicPress, handleMicRelease]);

  /* Phase 6 — voice-activated talk (Silero VAD). The mic runs only while it's
     the user's turn AND the avatar is not speaking/thinking (echo guard). */
  const vadWindow = talkMode === "vad" && active && vadReady;

  useEffect(() => {
    if (!vadWindow) {
      void vad.stop();
      setListening(false);
      return;
    }
    void vad.start({
      onUtterance: (audio) => void onUtterance(audio),
    });
    setListening(true);
    return () => {
      void vad.stop();
      setListening(false);
    };
    /* Deps deliberately use the stable functions, not the `vad` context
       object, which changes identity every render (same pattern as the
       guide-chat VAD window in use-guide-chat.ts). */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vadWindow, vad.start, vad.stop, setListening, onUtterance]);

  const vadFallback = talkMode === "vad" && (!vad.supported || vad.state === "error");

  return {
    ptt,
    vad,
    micLatched,
    handleMicPress,
    handleMicRelease,
    vadFallback,
  };
}
