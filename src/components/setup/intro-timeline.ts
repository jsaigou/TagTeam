/** Pure phase math for the Get Started door intro (rendered by DoorsIntro).
 *
 *  Timeline: the double door draws itself as line art, becomes solid, someone
 *  knocks twice, the leaves swing open onto Luna waving in the doorway, and
 *  the facade fades out into the setup panel. All values are derived from a
 *  single elapsed-milliseconds number so the sequence is deterministic,
 *  skippable (jump straight to INTRO_END), and unit-testable.
 */

export type IntroPhase = "draw" | "knock" | "open" | "reveal" | "fade";

/** Outline stroke-drawing window (both leaves draw together). */
export const DRAW_MS = 1900;
/** Elapsed times of the two knock impacts. */
export const KNOCK_1_AT = 2150;
export const KNOCK_2_AT = 2500;
export const OPEN_START = 2950;
export const OPEN_MS = 1000;
/** Luna waves / speaks her greeting from here. */
export const REVEAL_START = 3950;
export const FADE_START = 6300;
export const FADE_MS = 500;
export const INTRO_END = 6800;

/** Swing amplitude per leaf; left leaf rotates -deg around its hinge edge,
 *  right leaf +deg — they part at the center split like real double doors. */
export const DOOR_MAX_DEG = 104;

/** Doorway hole geometry. Shared with AvatarStage so the stage card is framed
 *  exactly where DoorsIntro cuts its hole (the avatar is behind the doors). */
export const DOORWAY_WIDTH = "min(52vmin, 21rem)";
export const DOORWAY_HEIGHT = "min(72vmin, 30rem)";
/** How far the doorway center sits above the viewport center. */
export const DOORWAY_LIFT = "8svh";

export type IntroFrame = {
  phase: IntroPhase;
  /** Outline stroke progress 0..1. */
  draw: number;
  /** Wood-fill opacity — the line-art door solidifies just before the knock. */
  fill: number;
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
    return { phase: "draw", draw: 0, fill: 0, doorDeg: 0, jamb: 1, opacity: 1, knocks: 0 };
  }
  if (t >= INTRO_END) {
    return {
      phase: "fade",
      draw: 1,
      fill: 1,
      doorDeg: DOOR_MAX_DEG,
      jamb: 0,
      opacity: 0,
      knocks: 2,
    };
  }
  const phase: IntroPhase =
    t < KNOCK_1_AT
      ? "draw"
      : t < OPEN_START
        ? "knock"
        : t < REVEAL_START
          ? "open"
          : t < FADE_START
            ? "reveal"
            : "fade";
  const openP = clamp01((t - OPEN_START) / OPEN_MS);
  return {
    phase,
    draw: clamp01(t / DRAW_MS),
    fill: t < KNOCK_1_AT ? 0 : clamp01((t - KNOCK_1_AT) / 350),
    doorDeg: t <= OPEN_START ? 0 : easeInOut(openP) * DOOR_MAX_DEG,
    jamb: t <= OPEN_START ? 1 : 1 - easeInOut(openP),
    opacity: t < FADE_START ? 1 : 1 - easeInOut(clamp01((t - FADE_START) / FADE_MS)),
    knocks: t >= KNOCK_2_AT ? 2 : t >= KNOCK_1_AT ? 1 : 0,
  };
}
