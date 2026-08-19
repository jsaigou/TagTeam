import { describe, expect, it } from "vitest";

import {
  computeStory,
  STORY_END,
  WINDOW_BOX,
  DOOR_BOX,
  FULL_BOX,
  IDLE_END,
  APPROACH_END,
  DESCEND_END,
  DOOR_END,
  WAVE_END,
  SLIDE_END,
  ZOOM_END,
  INDOOR_END,
} from "./story";

const opts = { bobAmp: 9, bobMs: 1100 };

describe("house story timeline", () => {
  it("idle: cat upper-body in the window, waving, world at rest", () => {
    const s = computeStory(0, opts);
    expect(s.phase).toBe("idle");
    expect(s.worldScale).toBe(1);
    expect(s.tx).toBe(0);
    expect(s.bobY).toBe(0);
    expect(s.fov).toBe(2.4);
    expect(s.doorDeg).toBe(0);
    expect(s.avatar).toMatchObject({ ...WINDOW_BOX, opacity: 1, z: 5 });
    expect(s.camAngle).toBe("fullbody");
    expect(s.wave).toBe(true);
    expect(s.houseOpacity).toBe(1);
  });

  it("window only shows upper body — the card is taller than the window hole", () => {
    const s = computeStory(0, opts);
    expect(s.avatar.top).toBeLessThan(180); // head above the window sill
    expect(s.avatar.top + s.avatar.height).toBeGreaterThan(310); // legs below → wall hides them
  });

  it("approach: world grows, drifts left, bobs, FOV tightens", () => {
    const mid = computeStory((IDLE_END + APPROACH_END) / 2, opts);
    expect(mid.phase).toBe("approach");
    expect(mid.worldScale).toBeGreaterThan(1);
    expect(mid.worldScale).toBeLessThan(2.3);
    expect(mid.tx).toBeLessThan(0);
    expect(mid.fov).toBeLessThan(2.4);
    expect(mid.fov).toBeGreaterThan(1.4);
    expect(Math.abs(mid.bobY)).toBeGreaterThan(0);

    const end = computeStory(APPROACH_END - 1, opts);
    expect(end.worldScale).toBeCloseTo(2.3);
    expect(end.fov).toBeCloseTo(1.4);
  });

  it("descend: card slides window→door BEHIND the wall with no fade (no teleport)", () => {
    const mid = computeStory((APPROACH_END + DESCEND_END) / 2, opts);
    expect(mid.phase).toBe("descend");
    expect(mid.doorDeg).toBe(0); // door still closed
    expect(mid.avatar.opacity).toBe(1); // no crossfade
    expect(mid.avatar.z).toBe(5); // behind the wall
    expect(mid.avatar.left).toBeGreaterThan(DOOR_BOX.left);
    expect(mid.avatar.left).toBeLessThan(WINDOW_BOX.left);

    const end = computeStory(DESCEND_END - 1, opts);
    expect(end.avatar.left).toBeCloseTo(DOOR_BOX.left, 6);
  });

  it("door: swings open with the cat already present in the doorway", () => {
    const start = computeStory(DOOR_END - 500, opts);
    expect(start.phase).toBe("door");
    expect(start.doorDeg).not.toBe(0);
    expect(start.avatar).toMatchObject({ ...DOOR_BOX, opacity: 1, z: 5 });
    expect(start.avatar.opacity).toBe(1); // never fades out
  });

  it("wave: cat waves in the open doorway", () => {
    const s = computeStory(WAVE_END - 500, opts);
    expect(s.phase).toBe("wave");
    expect(s.wave).toBe(true);
    expect(s.doorDeg).toBe(-105);
    expect(s.avatar).toMatchObject(DOOR_BOX);
  });

  it("slide: cat quickly leaves the doorway, still hidden behind the wall", () => {
    const s = computeStory(SLIDE_END - 100, opts);
    expect(s.phase).toBe("slide");
    expect(s.avatar.left).toBeGreaterThan(DOOR_BOX.left + 250);
    expect(s.avatar.z).toBe(5);
    expect(s.wave).toBe(false);
  });

  it("zoom: fast push toward the now-empty doorway", () => {
    const s = computeStory(ZOOM_END - 100, opts);
    expect(s.phase).toBe("zoom");
    expect(s.worldScale).toBeCloseTo(3.1);
    expect(s.fov).toBeCloseTo(0.5);
    expect(s.avatar.z).toBe(5);
  });

  it("indoor: house fades out as the card expands into a full indoor scene", () => {
    const mid = computeStory((ZOOM_END + INDOOR_END) / 2, opts);
    expect(mid.phase).toBe("indoor");
    expect(mid.houseOpacity).toBeGreaterThan(0);
    expect(mid.houseOpacity).toBeLessThan(1);
    expect(mid.avatar.z).toBe(12);
    expect(mid.avatar.width).toBeGreaterThan(DOOR_BOX.width);
    expect(mid.camAngle).toBe("fullbody");
  });

  it("end: full indoor scene at a REGULAR size — Luna full-frame in her room", () => {
    const s = computeStory(STORY_END + 5000, opts);
    expect(s.phase).toBe("end");
    expect(s.houseOpacity).toBe(0);
    expect(s.avatar).toMatchObject(FULL_BOX);
    expect(s.avatar.z).toBe(12);
    expect(s.worldScale).toBeCloseTo(1); // back to regular size, not zoomed
    expect(s.tx).toBeCloseTo(0);
    expect(s.fov).toBe(0.9);
    expect(s.camAngle).toBe("fullbody");
    expect(s.wave).toBe(true);
  });
});
