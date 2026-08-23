import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeWavPcm16, wavToBase64 } from "@/lib/audio-utils";

export type VoiceTalkState = "idle" | "loading" | "listening" | "speaking" | "error";

export type VoiceTalkResult = {
  audioBase64: string;
  mimeType: "audio/wav";
};

type VadMic = {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  destroy: () => Promise<void>;
  listening: boolean;
};

/**
 * Silence-triggered talk (Phase 6): wraps @ricky0123/vad-web (Silero VAD via
 * onnxruntime-web) so the user can talk hands-free instead of holding a
 * button. The VAD runs in a Web Worker + AudioWorklet; the model + onnxruntime
 * wasm are lazy-loaded from CDN (mirroring the OpenCV.js pattern) so the main
 * bundle stays lean. `onSpeechEnd` yields a 16 kHz mono Float32Array, which is
 * encoded to the same 16 kHz mono WAV the push-to-talk path POSTs to
 * `/api/audio`.
 *
 * The MicVAD instance is created once and then paused/resumed across turns
 * (the model + AudioContext stay warm), and destroyed on unmount.
 */
export function useVoiceTalk() {
  const [state, setState] = useState<VoiceTalkState>("idle");
  const [error, setError] = useState<string | null>(null);

  const vadRef = useRef<VadMic | null>(null);
  const onUtteranceRef = useRef<((audio: VoiceTalkResult) => void) | null>(null);
  const activeRef = useRef(false);

  const supported = useMemo(() => {
    if (typeof navigator === "undefined" || typeof window === "undefined") return false;
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }, []);

  const start = useCallback(async (opts: { onUtterance: (audio: VoiceTalkResult) => void; preRollMs?: number }) => {
    if (activeRef.current || vadRef.current?.listening) return;
    activeRef.current = true;
    onUtteranceRef.current = opts.onUtterance;
    setError(null);
    setState("loading");
    try {
      let vad = vadRef.current;
      if (!vad) {
        const { MicVAD } = await import("@ricky0123/vad-web");
        vad = await MicVAD.new({
          model: "v5",
          startOnLoad: false,
          baseAssetPath: vadBaseAssetPath(),
          onnxWASMBasePath: vadWasmBasePath(),
          /* Pre-roll: keep this much audio before detected speech onset so
             the first word (e.g. a barge-in) is never clipped. */
          preSpeechPadMs: opts.preRollMs,
          onSpeechStart: () => setState("speaking"),
          onSpeechEnd: (audio) => {
            setState("listening");
            if (!onUtteranceRef.current) return;
            const wav = encodeWavPcm16(audio);
            onUtteranceRef.current({ audioBase64: wavToBase64(wav), mimeType: "audio/wav" });
          },
        });
        if (!activeRef.current) {
          await vad.destroy().catch(() => {});
          setState("idle");
          return;
        }
        vadRef.current = vad;
      }
      await vad.start();
      if (!activeRef.current) {
        await vad.pause().catch(() => {});
        setState("idle");
        return;
      }
      setState("listening");
    } catch (err) {
      activeRef.current = false;
      const vad = vadRef.current;
      vadRef.current = null;
      if (vad) await vad.destroy().catch(() => {});
      setState("error");
      setError(vadErrorMessage(err));
    }
  }, []);

  /** Stop capturing for now, but keep the VAD instance warm for the next turn. */
  const stop = useCallback(async () => {
    activeRef.current = false;
    onUtteranceRef.current = null;
    const vad = vadRef.current;
    if (vad?.listening) {
      try {
        await vad.pause();
      } catch {
        /* best-effort cleanup */
      }
    }
    setState("idle");
  }, []);

  /* Destroy the VAD + mic when the owning component unmounts. */
  useEffect(
    () => () => {
      activeRef.current = false;
      const vad = vadRef.current;
      vadRef.current = null;
      if (vad) void vad.destroy().catch(() => {});
    },
    [],
  );

  return {
    supported,
    state,
    error,
    start,
    stop,
    clearError: () => setError(null),
  };
}

const VAD_WEB_VERSION = "0.0.30";
const ONNX_WASM_VERSION = "1.27.0";
const DEFAULT_VAD_BASE_ASSET_PATH = `https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@${VAD_WEB_VERSION}/dist/`;
const DEFAULT_ONNX_WASM_PATH = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_WASM_VERSION}/dist/`;

/** Silero VAD model + worklet directory (CDN by default, override for offline). */
function vadBaseAssetPath(): string {
  return (
    (import.meta.env.VITE_SILERO_VAD_URL as string | undefined) || DEFAULT_VAD_BASE_ASSET_PATH
  );
}

/** onnxruntime-web wasm directory (CDN by default, override for offline). */
function vadWasmBasePath(): string {
  return (
    (import.meta.env.VITE_SILERO_VAD_WASM_URL as string | undefined) || DEFAULT_ONNX_WASM_PATH
  );
}

function vadErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name;
  if (name === "NotAllowedError") {
    return "Microphone access was denied. Allow the microphone in your browser and try again.";
  }
  if (name === "NotFoundError") {
    return "No microphone was found. Plug one in and try again.";
  }
  return err instanceof Error ? err.message : "Voice detection could not start.";
}
