/**
 * Phase 5f — BYO TTS client.
 *
 * When `VITE_TTS_PROVIDER=byo`, avatar speech is generated server-side
 * (`POST /api/tts` → the configured OpenAI-compatible /audio/speech engine,
 * normalized to a 16 kHz mono WAV) and played through the presenter's
 * `presentWithAudio` instead of Perxona's built-in voice. Perxona stays the
 * default; this is the explicit opt-in BYO speech path (§7 AvatarSpeechProvider).
 */

/** True when the avatar should speak via BYO TTS (presentWithAudio). */
export function isByoEnabled(env?: Record<string, string | undefined>): boolean {
  const source = env ?? (import.meta.env as Record<string, string | undefined>);
  return (source.VITE_TTS_PROVIDER ?? "").toLowerCase() === "byo";
}

/**
 * Synthesize `text` to a 16 kHz mono WAV (the codec contract verified against
 * the presenter in the Phase 0 spike). Resolves with the raw bytes.
 */
export async function synthesizeSpeech(text: string): Promise<ArrayBuffer> {
  const res = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = (data as { error?: string }).error ?? res.statusText;
    throw new Error(message);
  }
  return res.arrayBuffer();
}
