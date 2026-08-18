/**
 * Audio capture helpers for push-to-talk (Phase 3).
 *
 * The browser records raw PCM via ScriptProcessor, then this module downsamples
 * to 16 kHz mono and encodes a WAV — the one format whisper.cpp decodes
 * natively (see server/providers.mjs), and that the hosted STT endpoints accept
 * too. Kept framework-free for unit tests.
 */

/** Downsample a mono signal from `fromRate` to `toRate` (linear interpolation). */
export function resampleMono(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = pos - i0;
    out[i] = samples[i0] + (samples[i1] - samples[i0]) * frac;
  }
  return out;
}

const WAV_SAMPLE_RATE = 16000;

/**
 * Encode 16 kHz mono float samples (-1..1) as a 16-bit PCM WAV `ArrayBuffer`.
 * whisper.cpp reads this format directly.
 */
export function encodeWavPcm16(samples16k: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(samples16k.length);
  for (let i = 0; i < samples16k.length; i++) {
    const s = Math.max(-1, Math.min(1, samples16k[i]));
    pcm[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  const bytesPerSample = 2;
  const dataSize = pcm.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, WAV_SAMPLE_RATE, true);
  view.setUint32(28, WAV_SAMPLE_RATE * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  const offset = 44;
  for (let i = 0; i < pcm.length; i++) view.setInt16(offset + i * 2, pcm[i], true);
  return buffer;
}

/** Encode + base64 (browser-safe, no Buffer). */
export function wavToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
