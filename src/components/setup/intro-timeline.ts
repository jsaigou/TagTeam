/** Pure phase math for the Get Started door intro (rendered by DoorsIntro).
 *
 *  Timeline: the door DRAWS like a human hand — one continuous line at a time,
 *  never parallel strokes. Order: outer casing outline first, then the left
 *  leaf (hinge edge → top → bottom → panel moldings → center split), then the
 *  right leaf the same way. Each stroke's duration is proportional to its
 *  path length, so long edges take longer exactly as a hand would. Only when
 *  the last line lands does the flat ink melt into walnut with brass fittings
 *  and 3D bevel edges (two knocks land while the material settles); the
 *  leaves swing outward onto Luna waving silently in her corner window; the
 *  facade fades away — and only after the fade completes does she greet
 *  (SetupScreen owns that trigger).
 *
 *  All values derive from a single elapsed-milliseconds number so the
 *  sequence is deterministic, skippable (jump straight to INTRO_END), and
 *  unit-testable.
 */

export type IntroPhase = "draw" | "texture" | "open" | "reveal" | "fade";

/** One stroke of the single-hand drawing pass, in drawing order. `weight` is
 *  the path's length in viewBox units — stroke duration ∝ weight. */
export const STROKES: readonly { key: string; weight: number }[] = [
  { key: "casing", weight: 896 }, // outer frame (194x260 rect perimeter)
  { key: "hingeL", weight: 256 },
  { key: "topL", weight: 96 },
  { key: "bottomL", weight: 96 },
  { key: "panelL1", weight: 316 },
  { key: "panelL2", weight: 336 },
  { key: "splitL", weight: 256 },
  { key: "hingeR", weight: 256 },
  { key: "topR", weight: 96 },
  { key: "bottomR", weight: 96 },
  { key: "panelR1", weight: 316 },
  { key: "panelR2", weight: 336 },
  { key: "splitR", weight: 256 },
];

/** Hand speed: ms of drawing time per unit of path length. */
export const STROKE_SPEED_MS = 0.75;

/** Cumulative [startMs, durMs] per stroke, same order as STROKES. */
export const STROKE_SPANS: readonly { key: string; start: number; dur: number }[] =
  (() => {
    let t = 0;
    return STROKES.map(({ key, weight }) => {
      const dur = weight * STROKE_SPEED_MS;
      const span = { key, start: t, dur };
      t += dur;
      return span;
    });
  })();

const TOTAL_WEIGHT = STROKES.reduce((sum, s) => sum + s.weight, 0);

/** Stroke lookup by key (DoorsIntro maps SVG paths to plan entries). */
export const STROKE_INDEX: Readonly<Record<string, number>> = Object.fromEntries(
  STROKES.map((s, i) => [s.key, i]),
);

/** Last stroke completes here — the outline is finished. */
export const DRAW_END_MS = STROKE_SPANS[STROKE_SPANS.length - 1].start +
  STROKE_SPANS[STROKE_SPANS.length - 1].dur;
/** Material transition: walnut + brass + bevels fade in over the line art. */
export const TEXTURE_START = Math.round(DRAW_END_MS + 150);
export const TEXTURE_MS = 600;
/** Elapsed times of the two knock impacts (inside the texture beat). */
export const KNOCK_1_AT = TEXTURE_START + 250;
export const KNOCK_2_AT = KNOCK_1_AT + 350;
export const OPEN_START = KNOCK_2_AT + 900;
export const OPEN_MS = 1000;
/** Luna waves (motion only — speech waits for the fade to finish). */
export const REVEAL_START = OPEN_START + OPEN_MS;
export const FADE_START = REVEAL_START + 2500;
export const FADE_MS = 500;
export const INTRO_END = FADE_START + FADE_MS;

/** Swing amplitude per leaf; left leaf rotates -deg around its hinge edge,
 *  right leaf +deg — they part at the center split like real double doors. */
export const DOOR_MAX_DEG = 104;

export type IntroFrame = {
  phase: IntroPhase;
  /** Per-stroke progress 0..1, aligned with STROKES / STROKE_SPANS order. */
  strokes: number[];
  /** Weighted overall ink progress 0..1 (drives the interior darkening). */
  inked: number;
  /** Material transition 0..1 — line art settles into walnut+brass. */
  texture: number;
  /** Leaf swing degrees 0..DOOR_MAX_DEG. */
  doorDeg: number;
  /** Dark doorway backing behind the leaves; darkens in with the drawing and
   *  fades away as they part so the avatar behind becomes visible. */
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
    strokes.reduce(
      (sum, p, i) => sum + p * STROKES[i].weight,
      0,
    ) / TOTAL_WEIGHT;
  return {
    phase,
    strokes,
    inked,
    texture:
      t <= TEXTURE_START ? 0 : clamp01((t - TEXTURE_START) / TEXTURE_MS),
    doorDeg: t <= OPEN_START ? 0 : easeInOut(openP) * DOOR_MAX_DEG,
    /* OPAQUE from frame zero — it hides the avatar behind the doorway for the
       whole draw, matching the page background so the region reads as blank
       space until the traced outline lands on it. Fades only as the leaves
       part. */
    jamb:
      t <= OPEN_START
        ? 1
        : 1 - easeInOut(openP),
    opacity: t < FADE_START ? 1 : 1 - easeInOut(clamp01((t - FADE_START) / FADE_MS)),
    knocks: t >= KNOCK_2_AT ? 2 : t >= KNOCK_1_AT ? 1 : 0,
  };
}
