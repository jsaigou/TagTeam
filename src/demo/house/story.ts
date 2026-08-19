/** Pure story math for the house demo — no React, unit-testable. */

export const IDLE_END = 2500;
export const APPROACH_END = 7000;
export const DESCEND_END = 8200;
export const DOOR_END = 9700;
export const WAVE_END = 11500;
export const SLIDE_END = 12300;
export const ZOOM_END = 13800;
export const INDOOR_END = 15200;
export const STORY_END = INDOOR_END;

/**
 * The avatar card is always larger than the hole it shows through, so the wall
 * crops it: from the WINDOW you only see the cat's upper body (the lower body
 * is below the window sill, hidden by the opaque wall) — never the whole body.
 */
export const WINDOW_BOX = { left: 290, top: 168, width: 190, height: 212 };
export const DOOR_BOX = { left: 285, top: 345, width: 250, height: 235 };
export const FULL_BOX = { left: 0, top: 0, width: 900, height: 700 };

export type AvatarBox = {
  left: number;
  top: number;
  width: number;
  height: number;
  opacity: number;
  z: number;
};

export type PhaseId =
  | "idle"
  | "approach"
  | "descend"
  | "door"
  | "wave"
  | "slide"
  | "zoom"
  | "indoor"
  | "end";

export type SceneState = {
  phase: PhaseId;
  worldScale: number;
  tx: number;
  bobY: number;
  fov: number;
  doorDeg: number;
  camAngle: "fullbody" | "halfbody";
  avatar: AvatarBox;
  wave: boolean;
  /** Opacity of the house/backdrop layer (fades to 0 for the indoor scene). */
  houseOpacity: number;
};

export type StoryOpts = { bobAmp: number; bobMs: number };

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

const boxLerp = (
  a: Pick<AvatarBox, "left" | "top" | "width" | "height">,
  b: Pick<AvatarBox, "left" | "top" | "width" | "height">,
  t: number,
) => ({
  left: lerp(a.left, b.left, t),
  top: lerp(a.top, b.top, t),
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
});

/** Maps elapsed story time (ms) to a full scene pose. */
export function computeStory(elapsed: number, opts: StoryOpts): SceneState {
  const t = clamp01(elapsed / STORY_END) * STORY_END;

  let phase: PhaseId;
  if (t < IDLE_END) phase = "idle";
  else if (t < APPROACH_END) phase = "approach";
  else if (t < DESCEND_END) phase = "descend";
  else if (t < DOOR_END) phase = "door";
  else if (t < WAVE_END) phase = "wave";
  else if (t < SLIDE_END) phase = "slide";
  else if (t < ZOOM_END) phase = "zoom";
  else if (t < INDOOR_END) phase = "indoor";
  else phase = "end";

  const bob = phase === "approach" ? Math.sin((t / opts.bobMs) * Math.PI * 2) * opts.bobAmp : 0;

  let worldScale = 1;
  let tx = 0;
  let fov = 2.4;
  let doorDeg = 0;
  let camAngle: "fullbody" | "halfbody" = "fullbody";
  let avatar: AvatarBox = { ...WINDOW_BOX, opacity: 1, z: 5 };
  let wave = phase === "idle";
  let houseOpacity = 1;

  if (phase === "approach") {
    const e = easeInOut(clamp01((t - IDLE_END) / (APPROACH_END - IDLE_END)));
    worldScale = lerp(1, 2.3, e);
    tx = lerp(0, -40, e);
    fov = lerp(2.4, 1.4, e);
  } else if (phase === "descend") {
    // The card slides from the window down to the doorway. It is fully hidden
    // (off-screen + behind the opaque wall), so the cat never teleports.
    const e = easeInOut(clamp01((t - APPROACH_END) / (DESCEND_END - APPROACH_END)));
    worldScale = 2.3;
    tx = -40;
    fov = 1.4;
    avatar = { ...boxLerp(WINDOW_BOX, DOOR_BOX, e), opacity: 1, z: 5 };
  } else if (phase === "door") {
    // Door swings open with the cat ALREADY standing in the doorway.
    const e = easeInOut(clamp01((t - DESCEND_END) / (DOOR_END - DESCEND_END)));
    worldScale = 2.3;
    tx = -40;
    fov = 1.4;
    doorDeg = lerp(0, -105, e);
    avatar = { ...DOOR_BOX, opacity: 1, z: 5 };
  } else if (phase === "wave") {
    worldScale = 2.3;
    tx = -40;
    fov = 1.4;
    doorDeg = -105;
    avatar = { ...DOOR_BOX, opacity: 1, z: 5 };
    wave = true;
  } else if (phase === "slide") {
    // Cat quickly slides out of the doorway (still behind the wall, so she is
    // hidden the moment she leaves the door gap).
    const e = easeInOut(clamp01((t - WAVE_END) / (SLIDE_END - WAVE_END)));
    worldScale = 2.3;
    tx = -40;
    fov = 1.4;
    doorDeg = -105;
    avatar = {
      left: lerp(DOOR_BOX.left, DOOR_BOX.left + 260, e),
      top: DOOR_BOX.top,
      width: DOOR_BOX.width,
      height: DOOR_BOX.height,
      opacity: 1,
      z: 5,
    };
  } else if (phase === "zoom") {
    // Fast zoom toward the now-empty doorway.
    const e = easeInOut(clamp01((t - SLIDE_END) / (ZOOM_END - SLIDE_END)));
    worldScale = lerp(2.3, 3.1, e);
    tx = -40;
    fov = lerp(1.4, 0.5, e);
    doorDeg = -105;
    avatar = {
      left: DOOR_BOX.left + 260,
      top: DOOR_BOX.top,
      width: DOOR_BOX.width,
      height: DOOR_BOX.height,
      opacity: 1,
      z: 5,
    };
  } else if (phase === "indoor" || phase === "end") {
    // The doorway expands to fill the frame while the house fades — a crossfade
    // into a full indoor scene with Luna in her room, back at a regular size.
    const p =
      phase === "indoor"
        ? easeInOut(clamp01((t - ZOOM_END) / (INDOOR_END - ZOOM_END)))
        : 1;
    worldScale = lerp(3.1, 1, p);
    tx = lerp(-40, 0, p);
    fov = lerp(0.5, 0.9, p);
    doorDeg = -105;
    camAngle = "fullbody";
    avatar = { ...boxLerp(DOOR_BOX, FULL_BOX, p), opacity: 1, z: p > 0.15 ? 12 : 5 };
    houseOpacity = 1 - p;
    wave = p > 0.5;
  }

  return { phase, worldScale, tx, bobY: bob, fov, doorDeg, camAngle, avatar, wave, houseOpacity };
}
