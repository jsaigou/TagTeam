let ctx: AudioContext | null = null;
let unlockPromise: Promise<void> | null = null;

/** Lazily create (and gesture-resume) our own AudioContext for UI sound
 *  effects. Independent from the presenter's internal context — the Get
 *  Started click calls this alongside unlockAudio(). */
export function unlockSfx(): Promise<void> {
  if (!ctx) {
    const Ctor = window.AudioContext;
    if (!Ctor) return Promise.resolve();
    ctx = new Ctor();
  }
  if (!unlockPromise || ctx.state === "closed") {
    unlockPromise = ctx.resume().then(async () => {});
  }
  return unlockPromise;
}

/** One door-knock impact: a low wooden thump plus a bright transient click.
 *  Safe to call before unlock — it just no-ops while suspended. */
export function playKnock(): void {
  if (!ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime + 0.01;

  // Wooden body — short pitched decay.
  const thump = ctx.createOscillator();
  thump.type = "triangle";
  thump.frequency.setValueAtTime(96 + Math.random() * 10, t0);
  thump.frequency.exponentialRampToValueAtTime(52, t0 + 0.11);
  const thumpGain = ctx.createGain();
  thumpGain.gain.setValueAtTime(0.0001, t0);
  thumpGain.gain.exponentialRampToValueAtTime(0.5, t0 + 0.008);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);

  // Knuckle transient — filtered noise burst.
  const noiseDur = 0.05;
  const noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * noiseDur), ctx.sampleRate);
  const samples = noiseBuffer.getChannelData(0);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = (Math.random() * 2 - 1) * (1 - i / samples.length);
  }
  const knockNoise = ctx.createBufferSource();
  knockNoise.buffer = noiseBuffer;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1100;
  band.Q.value = 0.9;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.35, t0);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + noiseDur);

  thump.connect(thumpGain).connect(ctx.destination);
  knockNoise.connect(band).connect(noiseGain).connect(ctx.destination);
  thump.start(t0);
  thump.stop(t0 + 0.2);
  knockNoise.start(t0);
}
