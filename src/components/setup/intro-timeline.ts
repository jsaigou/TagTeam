/** Pure phase math for the Get Started door intro (rendered by DoorsIntro).
 *
 *  Ported from the /demo3 tech demo. Timeline: the door DRAWS like a human
 *  hand — ONE continuous stroke at a time, longest lines first, constant hand
 *  speed so duration ∝ path length; the whole pass is ~1 second. Only when
 *  the last line lands does the flat ink melt into walnut with brass fittings
 *  and 3D bevel edges (two knocks land while the material settles); the
 *  leaves swing outward onto Luna waving silently in her corner window; the
 *  facade fades away — and only after the fade completes does she greet
 *  (SetupScreen owns that trigger).
 *
 *  All geometry lives in ONE square viewBox (0 0 400 400) rendered at uniform
 *  scale — no non-uniform stretching, no <rect> dash quirks: every stroke is
 *  an explicit <path>, drawn imperatively (dashoffset via refs) by DoorsIntro.
 *  Everything derives from a single elapsed-milliseconds number so the
 *  sequence is deterministic, skippable (jump straight to INTRO_END), and
 *  unit-testable.
 */

export type IntroPhase = "draw" | "texture" | "open" | "reveal" | "fade";

/** One human stroke, in drawing order (longest first). */
export interface StrokeDef {
  key: string;
  label: string;
  /** Absolute path data in the shared 400×400 space. */
  d: string;
  /** Path length in viewBox units — duration ∝ weight. */
  weight: number;
}

const rectPath = (x: number, y: number, w: number, h: number): string =>
  `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`;

const circlePath = (cx: number, cy: number, r: number): string =>
  `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy}`;

/** Drawing order = weight descending (longest continuous lines first):
 *  casing perimeter → panels → threshold → split → knobs. */
export const STROKES: readonly StrokeDef[] = [
  { key: "casing", label: "Casing", d: rectPath(24, 24, 352, 352), weight: 4 * 352 },
  { key: "panelL", label: "Left panel", d: rectPath(56, 64, 120, 160), weight: 2 * (120 + 160) },
  { key: "panelR", label: "Right panel", d: rectPath(224, 64, 120, 160), weight: 2 * (120 + 160) },
  { key: "threshold", label: "Threshold", d: "M14 376 L386 376", weight: 372 },
  { key: "split", label: "Center split", d: "M200 24 L200 376", weight: 352 },
  { key: "knobL", label: "Left knob", d: circlePath(182, 280, 11), weight: 2 * Math.PI * 11 },
  { key: "knobR", label: "Right knob", d: circlePath(218, 280, 11), weight: 2 * Math.PI * 11 },
];

/** The whole hand-drawing pass takes about this long (target A spec: ~1s). */
export const DRAW_END_MS = 1000;

/** Cumulative [startMs, durMs] per stroke; durations ∝ length at constant
 *  hand speed, normalized so the full pass lands exactly on DRAW_END_MS. */
export const STROKE_SPANS: readonly { key: string; start: number; dur: number }[] =
  (() => {
    const total = STROKES.reduce((sum, s) => sum + s.weight, 0);
    let t = 0;
    return STROKES.map(({ key, weight }) => {
      const dur = (weight / total) * DRAW_END_MS;
      const span = { key, start: t, dur };
      t += dur;
      return span;
    });
  })();

/** Stroke lookup by key. */
export const STROKE_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  STROKES.map((s, i) => [s.key, i]),
);

const TOTAL_WEIGHT = STROKES.reduce((sum, s) => sum + s.weight, 0);

/** Material transition: walnut + brass + bevels fade in over the line art. */
export const TEXTURE_START = Math.round(DRAW_END_MS + 150);
export const TEXTURE_MS = 600;
/** Elapsed times of the two knock impacts (inside the texture beat). */
export const KNOCK_1_AT = TEXTURE_START + 200;
export const KNOCK_2_AT = KNOCK_1_AT + 350;
export const OPEN_START = TEXTURE_START + TEXTURE_MS + 600;
export const OPEN_MS = 1000;
/** Luna waves (motion only — speech waits for the fade to finish). */
export const REVEAL_START = OPEN_START + OPEN_MS;
export const FADE_START = REVEAL_START + 2500;
export const FADE_MS = 500;
export const INTRO_END = FADE_START + FADE_MS;

/** Swing amplitude per leaf; left leaf rotates -deg around its hinge edge,
 *  right leaf +deg — they part at the center split like real double doors. */
export const DOOR_MAX_DEG = 105;

export type IntroFrame = {
  phase: IntroPhase;
  /** Per-stroke progress 0..1, aligned with STROKES / STROKE_SPANS order. */
  strokes: number[];
  /** Weighted overall ink progress 0..1. */
  inked: number;
  /** Material transition 0..1 — line art settles into walnut+brass. */
  texture: number;
  /** Leaf swing degrees 0..DOOR_MAX_DEG. */
  doorDeg: number;
  /** Dark doorway backing behind the leaves; hides the avatar from frame
   *  zero and fades away only as they part. */
  jamb: number;
  /** Facade opacity (fades to 0 at the very end). */
  opacity: number;
  /** Number of knock impacts that should have sounded by now. */
  knocks: number;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const easeInOut = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

export function computeIntro(t: number): IntroFrame {
  if (t <= 0) {
    return {
      phase: "draw",
      strokes: STROKES.map(() => 0),
      inked: 0,
      texture: 0,
      doorDeg: 0,
      jamb: 1,
      opacity: 1,
      knocks: 0,
    };
  }
  if (t >= INTRO_END) {
    return {
      phase: "fade",
      strokes: STROKES.map(() => 1),
      inked: 1,
      texture: 1,
      doorDeg: DOOR_MAX_DEG,
      jamb: 0,
      opacity: 0,
      knocks: 2,
    };
  }
  const phase: IntroPhase =
    t < TEXTURE_START
      ? "draw"
      : t < OPEN_START
        ? "texture"
        : t < REVEAL_START
          ? "open"
          : t < FADE_START
            ? "reveal"
            : "fade";
  const openP = clamp01((t - OPEN_START) / OPEN_MS);
  const strokes = STROKE_SPANS.map((span) =>
    t <= span.start ? 0 : clamp01((t - span.start) / span.dur),
  );
  const inked =
    strokes.reduce((sum, p, i) => sum + p * STROKES[i].weight, 0) / TOTAL_WEIGHT;
  return {
    phase,
    strokes,
    inked,
    texture: clamp01((t - TEXTURE_START) / TEXTURE_MS),
    doorDeg: easeInOut(openP) * DOOR_MAX_DEG,
    /* OPAQUE from frame zero — it hides the avatar behind the doorway for the
       whole draw; fades only as the leaves part. */
    jamb: 1 - easeInOut(openP),
    opacity: t < FADE_START ? 1 : 1 - easeInOut(clamp01((t - FADE_START) / FADE_MS)),
    knocks: t >= KNOCK_2_AT ? 2 : t >= KNOCK_1_AT ? 1 : 0,
  };
}
