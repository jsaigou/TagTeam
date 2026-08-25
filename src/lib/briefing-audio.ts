/**
 * Briefing audio for the prep screen — an original Metal-Gear-briefing
 * PASTICHE built entirely from WebAudio primitives (no copyrighted game
 * assets): a two-tone "detection" stab for each bullet reveal, a
 * filtered-noise cough to end the transmission, and the briefing line itself
 * via the browser's speech synthesis pitched down into a low male register
 * (codec-radio vibe). Everything degrades silently when the APIs are
 * unavailable — the caller always shows subtitles alongside.
 *
 * Framework-free; the AudioContext is lazy and shared across calls. Autoplay
 * policies may keep it suspended until the next user gesture — callers should
 * re-kick `resumeBriefingAudio()` from a pointerdown handler.
 */

let ctx: AudioContext | null = null;

type AudioContextCtor = new () => AudioContext;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!ctor) return null;
  if (!ctx) ctx = new ctor();
  return ctx;
}

/** Resume the shared context (call from a user-gesture handler). */
export function resumeBriefingAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

/** Sharp two-stab square-wave "detected" cue — original approximation. */
export function playDetectionCue(): void {
  const c = getCtx();
  if (!c || c.state !== "running") return;
  const t0 = c.currentTime;
  const master = c.createGain();
  master.gain.value = 0.16;
  master.connect(c.destination);

  const stab = (at: number, from: number, to: number) => {
    const osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.linearRampToValueAtTime(to, at + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(1, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
    osc.connect(g).connect(master);
    osc.start(at);
    osc.stop(at + 0.22);
  };
  stab(t0, 920, 640);
  stab(t0 + 0.19, 1240, 860);
}

/** A dry double cough — band-passed noise bursts. */
export function playCough(): void {
  const c = getCtx();
  if (!c || c.state !== "running") return;
  const t0 = c.currentTime;
  const length = Math.floor(c.sampleRate * 0.35);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

  const burst = (at: number, peak: number) => {
    const src = c.createBufferSource();
    src.buffer = buffer;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900;
    bp.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.14);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(at);
    src.stop(at + 0.16);
  };
  burst(t0, 0.5);
  burst(t0 + 0.17, 0.34);
}

/** Pick a deep male-ish English voice when one is installed. */
function pickLowVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => /en/i.test(v.lang) && /male|david|daniel|fred|alex|george/i.test(v.name)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null
  );
}

/** Speak `text` in a lowered pitch (the briefing voice). Resolves when the
 *  utterance finishes, errors, or speech is unavailable — never hangs: a
 *  watchdog resolves after `fallbackMs` if no end event fires. Returns false
 *  when speech could not run at all (caller relies on subtitles). */
export function speakBriefingLine(text: string, fallbackMs = 12_000): Promise<boolean> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    let watchdog = 0;
    const finish = (spoke: boolean) => {
      if (done) return;
      done = true;
      window.clearTimeout(watchdog);
      resolve(spoke);
    };
    try {
      speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.82;
      utter.pitch = 0.1;
      utter.volume = 1;
      const voice = pickLowVoice();
      if (voice) utter.voice = voice;
      utter.onend = () => finish(true);
      utter.onerror = () => finish(false);
      speechSynthesis.speak(utter);
      // Some engines never fire onend (voices blocked, background tab).
      watchdog = window.setTimeout(() => finish(false), fallbackMs);
    } catch {
      finish(false);
    }
  });
}

/** Stop any in-flight briefing speech (skip/unmount). */
export function cancelBriefingSpeech(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
