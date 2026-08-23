/** Pure phase math for the Get Started door intro (rendered by DoorsIntro).
 *
 *  Timeline: the outer door shape draws itself as line art in the brand
 *  color, then the vertical center split adds the double-leaf seam; the flat
 *  ink melts into walnut with brass fittings and 3D bevel edges (two knocks
 *  land while the material settles); the leaves swing outward onto Luna
 *  waving silently in her corner window; the facade fades away — and only
 *  after the fade completes does she greet (SetupScreen owns that trigger).
 *
 *  All values derive from a single elapsed-milliseconds number so the
 *  sequence is deterministic, skippable (jump straight to INTRO_END), and
 *  unit-testable.
 */

export type IntroPhase = "draw" | "texture" | "open" | "reveal" | "fade";

/** Outer outline window: casing + each leaf's hinge/top/bottom edges. */
export const DRAW_OUTER_MS = 1300;
/** The vertical center split draws after the outer shape completes. */
export const DRAW_SPLIT_START = 1300;
export const DRAW_SPLIT_MS = 700;
/** Material transition: walnut + brass + bevels fade in over the line art. */
export const TEXTURE_START = 2200;
export const TEXTURE_MS = 600;
/** Elapsed times of the two knock impacts (inside the texture beat). */
export const KNOCK_1_AT = 2450;
export const KNOCK_2_AT = 2800;
export const OPEN_START = 3400;
export const OPEN_MS = 1000;
/** Luna waves (motion only — speech waits for the fade to finish). */
export const REVEAL_START = 4400;
export const FADE_START = 6900;
export const FADE_MS = 500;
export const INTRO_END = 7400;

/** Swing amplitude per leaf; left leaf rotates -deg around its hinge edge,
 *  right leaf +deg — they part at the center split like real double doors. */
export const DOOR_MAX_DEG = 104;

export type IntroFrame = {
  phase: IntroPhase;
  /** Outer outline progress 0..1. */
  drawOuter: number;
  /** Center-split progress 0..1. */
  drawSplit: number;
  /** Material transition 0..1 — line art settles into walnut+brass. */
  texture: number;
  /** Leaf swing degrees 0..DOOR_MAX_DEG. */
  doorDeg: number;
  /** Dark doorway backing behind the leaves; fades away as they part so the
   *  avatar behind becomes visible. */
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
      drawOuter: 0,
      drawSplit: 0,
      texture: 0,
      doorDeg: 0,
      jamb: 0,
      opacity: 1,
      knocks: 0,
    };
  }
  if (t >= INTRO_END) {
    return {
      phase: "fade",
      drawOuter: 1,
      drawSplit: 1,
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
  return {
    phase,
    drawOuter: clamp01(t / DRAW_OUTER_MS),
    drawSplit: t <= DRAW_SPLIT_START ? 0 : clamp01((t - DRAW_SPLIT_START) / DRAW_SPLIT_MS),
    texture:
      t <= TEXTURE_START ? 0 : clamp01((t - TEXTURE_START) / TEXTURE_MS),
    doorDeg: t <= OPEN_START ? 0 : easeInOut(openP) * DOOR_MAX_DEG,
    /* The dark interior fades in WITH the outline draw (not before it), so the
       line art is visible drawing itself over the avatar — a solid slab from
       frame zero would hide the whole stroke animation. */
    jamb:
      t <= OPEN_START
        ? easeInOut(clamp01(t / DRAW_OUTER_MS))
        : 1 - easeInOut(openP),
    opacity: t < FADE_START ? 1 : 1 - easeInOut(clamp01((t - FADE_START) / FADE_MS)),
    knocks: t >= KNOCK_2_AT ? 2 : t >= KNOCK_1_AT ? 1 : 0,
  };
}
