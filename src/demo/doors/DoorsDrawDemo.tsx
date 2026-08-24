import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import {
  computeDoors,
  DOOR_MAX_DEG,
  DRAW_MS,
  INTRO_END,
  OPEN_START,
  STROKES,
  STROKE_SPANS,
  TEXTURE_START,
  type DoorsFrame,
} from "./timeline";

const WALNUT = "linear-gradient(168deg, #6e4a30 0%, #593a2a 55%, #452b21 100%)";
const BRASS =
  "radial-gradient(circle at 35% 30%, #e6c37a 0%, #c89b4a 45%, #8a6a2f 100%)";

const bevelShadow = (left: boolean): string =>
  left
    ? "inset 5px 0 9px rgba(0,0,0,.5), inset -4px 0 7px rgba(255,255,255,.16), inset 0 3px 5px rgba(255,255,255,.08), inset 0 -4px 7px rgba(0,0,0,.4)"
    : "inset -5px 0 9px rgba(0,0,0,.5), inset 4px 0 7px rgba(255,255,255,.16), inset 0 3px 5px rgba(255,255,255,.08), inset 0 -4px 7px rgba(0,0,0,.4)";

/** One hinged leaf: invisible while the ink draws (target A), fades into
 *  walnut + brass (target B), swings outward around its hinge edge (C). */
const Leaf = forwardRef<HTMLDivElement, { side: "left" | "right"; frame: DoorsFrame }>(
  function Leaf({ side, frame }, ref) {
  const left = side === "left";
  const texture = frame.texture;
  const deg = (left ? -1 : 1) * frame.doorDeg;
  return (
    <div
      ref={ref}
      className="absolute will-change-transform"
      style={{
        top: "9%",
        height: "85%",
        [left ? "left" : "right"]: "9%",
        width: "41%",
        transformOrigin: left ? "left center" : "right center",
        transform: `rotateY(${deg}deg)`,
        backfaceVisibility: "hidden",
      }}
    >
      {/* Walnut material fading in over the line art (target B). */}
      <div className="absolute inset-0" style={{ background: WALNUT, opacity: texture }} />
      <div className="absolute inset-0" style={{ boxShadow: bevelShadow(left), opacity: texture }} />
      {/* Routed panel outline in the wood. */}
      <div
        className="absolute rounded-sm"
        style={{
          left: "14%",
          right: "14%",
          top: "9%",
          height: "46%",
          border: "2px solid rgba(0,0,0,.35)",
          boxShadow: "inset 0 1px 2px rgba(255,255,255,.12)",
          opacity: texture,
        }}
      />
      {/* Brass knob beside the split… */}
      <div
        className="absolute rounded-full"
        style={{
          opacity: texture,
          [left ? "right" : "left"]: "6%",
          top: "68%",
          width: "11%",
          aspectRatio: "1",
          background: BRASS,
          boxShadow: "0 1px 3px rgba(0,0,0,.55), inset 0 1px 1px rgba(255,255,255,.5)",
        }}
      />
      {/* …and brass hinges on the hinge edge. */}
      {[0.12, 0.62].map((y) => (
        <div
          key={y}
          className="absolute"
          style={{
            opacity: texture,
            [left ? "left" : "right"]: "3%",
            top: `${y * 100}%`,
            width: "5%",
            height: "9%",
            borderRadius: 2,
            background: BRASS,
            boxShadow: "inset 0 1px 1px rgba(255,255,255,.4)",
          }}
        />
      ))}
    </div>
  );
});

export function DoorsDrawDemo() {
  const [playing, setPlaying] = useState(false);
  const [, forceRender] = useState(0);
  const timeRef = useRef(0);
  const rafRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const strokeRefs = useRef<(SVGPathElement | null)[]>([]);
  const lineArtRef = useRef<SVGGElement | null>(null);
  const leafLRef = useRef<HTMLDivElement | null>(null);
  const leafRRef = useRef<HTMLDivElement | null>(null);

  /** Push one frame to the DOM imperatively — no React re-render per frame,
   *  so stroke-dashoffset updates never stutter. */
  const apply = useCallback((t: number) => {
    timeRef.current = t;
    const f = computeDoors(t);
    STROKE_SPANS.forEach((_, i) => {
      const el = strokeRefs.current[i];
      if (!el) return;
      const p = f.strokes[i];
      /* Round caps would leave a dot at offset 1 — hide untouched strokes. */
      el.style.visibility = p <= 0 ? "hidden" : "visible";
      el.style.strokeDashoffset = String(1 - p);
    });
    if (lineArtRef.current) lineArtRef.current.style.opacity = String(1 - f.texture);
    for (const el of [leafLRef.current, leafRRef.current]) {
      if (!el) continue;
      const left = el === leafLRef.current;
      el.style.transform = `rotateY(${(left ? -1 : 1) * f.doorDeg}deg)`;
    }
    if (stageRef.current) stageRef.current.style.opacity = String(f.opacity);
    return f;
  }, []);

  const syncUi = useCallback(() => forceRender((n) => n + 1), []);

  useEffect(() => {
    if (!playing) {
      lastTsRef.current = null;
      return;
    }
    const tick = (now: number) => {
      if (lastTsRef.current === null) lastTsRef.current = now;
      const dt = now - lastTsRef.current;
      lastTsRef.current = now;
      const t = timeRef.current + dt;
      if (t >= INTRO_END) {
        apply(INTRO_END);
        setPlaying(false);
        syncUi();
        return;
      }
      apply(t);
      /* Throttle React updates to ~15 Hz; drawing stays buttery at 60+. */
      if (Math.floor(t / 66) !== Math.floor((t - dt) / 66)) syncUi();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, apply, syncUi]);

  const scrubTo = useCallback(
    (t: number) => {
      setPlaying(false);
      apply(Math.max(0, Math.min(INTRO_END, t)));
      syncUi();
    },
    [apply, syncUi],
  );

  useEffect(() => {
    apply(0);
  }, [apply]);

  const t = timeRef.current;
  const frame = computeDoors(t);

  const btn =
    "rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:border-zinc-500";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">
          Doors drawing tech demo <span className="text-zinc-500">(/demo3)</span>
        </h1>
        <span className="rounded-full border border-lime-500/40 bg-lime-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-lime-300">
          Target {frame.phase === "draw" ? "A" : frame.phase === "texture" ? "B" : "C"}
          · {frame.phase}
        </span>
      </header>

      <div className="flex flex-col gap-6 sm:flex-row">
        {/* Stage — 1:1 square. */}
        <div
          className="relative shrink-0 self-center rounded-2xl bg-zinc-900 shadow-[0_12px_32px_rgba(0,0,0,.45)] ring-1 ring-white/10 sm:self-start"
          style={{ width: "min(60vmin, 380px)", aspectRatio: "1", perspective: "1100px" }}
        >
          {/* Dark interior revealed as the leaves part (target C). */}
          <div className="absolute inset-0 rounded-2xl bg-black" />

          <Leaf ref={leafLRef} side="left" frame={frame} />
          <Leaf ref={leafRRef} side="right" frame={frame} />

          {/* Target A — the single-hand ink pass. One shared 400×400 space,
              uniform scale, paths only (no <rect> dash quirks). */}
          <svg
            viewBox="0 0 400 400"
            className="pointer-events-none absolute inset-0 z-20 h-full w-full"
          >
            <g
              ref={lineArtRef}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={4}
              stroke="var(--primary, #a3e635)"
            >
              {STROKES.map((s, i) => (
                <path
                  key={s.key}
                  ref={(el) => {
                    strokeRefs.current[i] = el;
                  }}
                  d={s.d}
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1}
                  style={{ visibility: "hidden" }}
                />
              ))}
            </g>
          </svg>
        </div>

        {/* Diagnostics + controls. */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={btn} onClick={() => setPlaying((p) => !p)}>
              {playing ? "⏸ Pause" : "▶ Play"}
            </button>
            <button type="button" className={btn} onClick={() => scrubTo(0)}>
              ↺ Replay
            </button>
            <button type="button" className={btn} onClick={() => scrubTo(0)}>
              A · draw
            </button>
            <button type="button" className={btn} onClick={() => scrubTo(TEXTURE_START)}>
              B · walnut
            </button>
            <button type="button" className={btn} onClick={() => scrubTo(OPEN_START)}>
              C · swing
            </button>
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-300">
            <span className="w-10 shrink-0">t</span>
            <input
              type="range"
              min={0}
              max={INTRO_END}
              step={10}
              value={Math.min(t, INTRO_END)}
              onChange={(e) => scrubTo(Number(e.target.value))}
              className="flex-1 accent-lime-500"
            />
            <span className="w-16 shrink-0 text-right tabular-nums text-zinc-400">
              {Math.round(t)}ms
            </span>
          </label>

          <div className="rounded-lg border border-white/10 p-2">
            <div className="mb-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
              Strokes — longest first, one at a time ({DRAW_MS} ms total)
            </div>
            <ul className="flex flex-col gap-1">
              {STROKES.map((s, i) => {
                const p = frame.strokes[i];
                const span = STROKE_SPANS[i];
                const active = p > 0 && p < 1;
                return (
                  <li key={s.key} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={
                        active
                          ? "w-24 truncate text-lime-300"
                          : p >= 1
                            ? "w-24 truncate text-zinc-400"
                            : "w-24 truncate text-zinc-600"
                      }
                    >
                      {s.label}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-lime-500 transition-none"
                        style={{ width: `${p * 100}%` }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right tabular-nums text-zinc-500">
                      {span.start.toFixed(0)}+{span.dur.toFixed(0)}ms
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <dl className="grid grid-cols-3 gap-2 text-[11px] text-zinc-400">
            <div className="rounded-lg border border-white/10 p-2">
              <dt>swing</dt>
              <dd className="tabular-nums text-zinc-200">
                {frame.doorDeg.toFixed(0)}° / {DOOR_MAX_DEG}°
              </dd>
            </div>
            <div className="rounded-lg border border-white/10 p-2">
              <dt>texture</dt>
              <dd className="tabular-nums text-zinc-200">{(frame.texture * 100).toFixed(0)}%</dd>
            </div>
            <div className="rounded-lg border border-white/10 p-2">
              <dt>opacity</dt>
              <dd className="tabular-nums text-zinc-200">{(frame.opacity * 100).toFixed(0)}%</dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
