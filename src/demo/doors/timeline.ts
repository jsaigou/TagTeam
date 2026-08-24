/** Pure phase math for the /demo3 doors drawing tech demo (targets A, B, C).
 *
 *  Target A — a 1:1 line drawing of double doors (each with a knob) that
 *  DRAWS like a human hand: ONE continuous stroke at a time, longest lines
 *  first, constant hand speed so each stroke's duration ∝ its path length.
 *  The whole drawing pass is ~1 second.
 *
 *  Target B — the flat ink fades into a 3D walnut door with brass fittings.
 *  Target C — both leaves swing outward on a 3D arch until fully open, then
 *  the whole thing fades away.
 *
 *  All geometry lives in one square viewBox (0 0 400 400) rendered at uniform
 *  scale — no non-uniform stretching, no <rect> dash quirks: every stroke is
 *  an explicit <path> so `pathLength=1` + dashoffset behaves identically
 *  everywhere. Everything derives from one elapsed-ms number → deterministic,
 *  scrubbable, unit-testable.
 */

export type DoorsPhase = "draw" | "texture" | "open" | "fade";

/** One human stroke, in drawing order (longest first). */
export interface StrokeDef {
  key: string;
  label: string;
  /** Absolute path data in the shared 400×400 space. */
  d: string;
  /** Path length in viewBox units — duration ∝ weight. */
  weight: number;
}

const rectPath = (
  x: number,
  y: number,
  w: number,
  h: number,
): string => `M${x} ${y} L${x + w} ${y} L${x + w} ${y + h} L${x} ${y + h} Z`;

const circlePath = (cx: number, cy: number, r: number): string =>
  `M${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy}`;

/** Drawing order = weight descending (the "longest continuous lines first"
 *  rule). Casing perimeter → panels → threshold → split → knobs. */
export const STROKES: readonly StrokeDef[] = [
  {
    key: "casing",
    label: "Casing (full frame)",
    d: rectPath(24, 24, 352, 352),
    weight: 4 * 352,
  },
  {
    key: "panelL",
    label: "Left panel",
    d: rectPath(56, 64, 120, 160),
    weight: 2 * (120 + 160),
  },
  {
    key: "panelR",
    label: "Right panel",
    d: rectPath(224, 64, 120, 160),
    weight: 2 * (120 + 160),
  },
  {
    key: "threshold",
    label: "Threshold / floor",
    d: "M14 376 L386 376",
    weight: 372,
  },
  {
    key: "split",
    label: "Center split",
    d: "M200 24 L200 376",
    weight: 352,
  },
  {
    key: "knobL",
    label: "Left knob",
    d: circlePath(182, 280, 11),
    weight: 2 * Math.PI * 11,
  },
  {
    key: "knobR",
    label: "Right knob",
    d: circlePath(218, 280, 11),
    weight: 2 * Math.PI * 11,
  },
];

/** The whole drawing pass takes about this long (target A spec: ~1s). */
export const DRAW_MS = 1000;

/** Cumulative [startMs, durMs] per stroke; durations ∝ length at constant
 *  hand speed, normalized so the full pass lands exactly on DRAW_MS. */
export const STROKE_SPANS: readonly { key: string; start: number; dur: number }[] =
  (() => {
    const total = STROKES.reduce((sum, s) => sum + s.weight, 0);
    let t = 0;
    return STROKES.map(({ key, weight }) => {
      const dur = (weight / total) * DRAW_MS;
      const span = { key, start: t, dur };
      t += dur;
      return span;
    });
  })();

export const STROKE_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  STROKES.map((s, i) => [s.key, i]),
);

/** Target B — ink settles into walnut + brass. */
export const TEXTURE_START = DRAW_MS + 150;
export const TEXTURE_MS = 700;
/** Target C — swing outward, hold, fade away. */
export const OPEN_START = TEXTURE_START + TEXTURE_MS + 300;
export const OPEN_MS = 900;
export const FADE_START = OPEN_START + OPEN_MS + 250;
export const FADE_MS = 500;
export const INTRO_END = FADE_START + FADE_MS;

/** Swing amplitude per leaf in degrees; left rotates −deg around its hinge,
 *  right +deg — they part at the center split like real double doors. */
export const DOOR_MAX_DEG = 105;

export interface DoorsFrame {
  phase: DoorsPhase;
  /** Per-stroke progress 0..1, aligned with STROKES order. */
  strokes: number[];
  /** Walnut+brass material fade 0..1 (target B). */
  texture: number;
  /** Leaf swing degrees 0..DOOR_MAX_DEG (target C). */
  doorDeg: number;
  /** Whole-stage opacity (final fade of target C). */
  opacity: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeInOut = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

export function computeDoors(t: number): DoorsFrame {
  if (t <= 0) {
    return {
      phase: "draw",
      strokes: STROKES.map(() => 0),
      texture: 0,
      doorDeg: 0,
      opacity: 1,
    };
  }
  if (t >= INTRO_END) {
    return {
      phase: "fade",
      strokes: STROKES.map(() => 1),
      texture: 1,
      doorDeg: DOOR_MAX_DEG,
      opacity: 0,
    };
  }
  const phase: DoorsPhase =
    t < TEXTURE_START ? "draw" : t < OPEN_START ? "texture" : t < FADE_START ? "open" : "fade";
  return {
    phase,
    strokes: STROKE_SPANS.map(({ start, dur }) =>
      t <= start ? 0 : clamp01((t - start) / dur),
    ),
    texture: clamp01((t - TEXTURE_START) / TEXTURE_MS),
    doorDeg: easeInOut(clamp01((t - OPEN_START) / OPEN_MS)) * DOOR_MAX_DEG,
    opacity: t < FADE_START ? 1 : 1 - easeInOut(clamp01((t - FADE_START) / FADE_MS)),
  };
}
