import { useCallback, useMemo, useRef, useState } from "react";
import { encodeWavPcm16, resampleMono, wavToBase64 } from "@/lib/audio-utils";

export type PushToTalkState = "idle" | "recording" | "error";

export type PushToTalkResult = {
  audioBase64: string;
  mimeType: "audio/wav";
};

const MIN_RECORDING_MS = 250;

/**
 * Hold-to-talk mic capture (Phase 3).
 *
 * `start()` requests the microphone and records raw PCM through a
 * ScriptProcessor node; `stop()` downsamples to 16 kHz mono, WAV-encodes it and
 * returns a base64 payload ready for `POST /api/audio`. Returns null when the
 * clip is too short to be useful. `start()` must run from a user gesture so the
 * AudioContext can resume (autoplay policy).
 */
export function usePushToTalk() {
  const [state, setState] = useState<PushToTalkState>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<{
    stream: MediaStream;
    context: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    chunks: Float32Array[];
    startedAt: number;
  } | null>(null);

  const supported = useMemo(() => {
    if (typeof navigator === "undefined" || typeof window === "undefined") return false;
    const AudioCtor =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(AudioCtor);
  }, []);

  const start = useCallback(async (): Promise<boolean> => {
    if (recorderRef.current) return false;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctor =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        stream.getTracks().forEach((t) => t.stop());
        setState("idle");
        setError("Audio capture is not supported in this browser.");
        return false;
      }
      const context = new Ctor();
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (event) => {
        chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(context.destination);
      recorderRef.current = { stream, context, source, processor, chunks, startedAt: Date.now() };
      setState("recording");
      return true;
    } catch (err) {
      setState("idle");
      setError(micErrorMessage(err));
      return false;
    }
  }, []);

  const stop = useCallback(async (): Promise<PushToTalkResult | null> => {
    const rec = recorderRef.current;
    if (!rec) return null;
    recorderRef.current = null;
    const { stream, context, source, processor, chunks, startedAt } = rec;

    try {
      source.disconnect();
      processor.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await context.close().catch(() => {});
    } catch {
      /* best-effort cleanup */
    }

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    if (total === 0 || Date.now() - startedAt < MIN_RECORDING_MS) {
      setState("idle");
      return null;
    }
    const merged = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    const mono16k = resampleMono(merged, context.sampleRate, 16000);
    const wav = encodeWavPcm16(mono16k);
    setState("idle");
    return { audioBase64: wavToBase64(wav), mimeType: "audio/wav" };
  }, []);

  /** Discard the current recording without returning audio. */
  const cancel = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    try {
      rec.source.disconnect();
      rec.processor.disconnect();
      rec.stream.getTracks().forEach((t) => t.stop());
      rec.context.close().catch(() => {});
    } catch {
      /* best-effort cleanup */
    }
    setState("idle");
  }, []);

  return { supported, state, error, start, stop, cancel, clearError: () => setError(null) };
}

function micErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : (err as { name?: string })?.name;
  if (name === "NotAllowedError") {
    return "Microphone access was denied. Allow the microphone in your browser and try again.";
  }
  if (name === "NotFoundError") {
    return "No microphone was found. Plug one in and try again.";
  }
  return err instanceof Error ? err.message : "Could not start the microphone.";
}
