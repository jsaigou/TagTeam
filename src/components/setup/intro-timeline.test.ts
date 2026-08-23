import { describe, expect, it } from "vitest";

import {
  computeIntro,
  DOOR_MAX_DEG,
  DRAW_OUTER_MS,
  DRAW_SPLIT_MS,
  DRAW_SPLIT_START,
  FADE_START,
  INTRO_END,
  KNOCK_1_AT,
  KNOCK_2_AT,
  OPEN_START,
  REVEAL_START,
  TEXTURE_MS,
  TEXTURE_START,
} from "./intro-timeline";

describe("computeIntro", () => {
  it("starts fully closed and undrawn", () => {
    const f = computeIntro(0);
    expect(f.phase).toBe("draw");
    expect(f.drawOuter).toBe(0);
    expect(f.drawSplit).toBe(0);
    expect(f.texture).toBe(0);
    expect(f.doorDeg).toBe(0);
    expect(f.jamb).toBe(1);
    expect(f.opacity).toBe(1);
    expect(f.knocks).toBe(0);
  });

  it("finishes fully open, textured, faded out, both knocks fired — the skip target", () => {
    const f = computeIntro(INTRO_END + 5000);
    expect(f.drawOuter).toBe(1);
    expect(f.drawSplit).toBe(1);
    expect(f.texture).toBe(1);
    expect(f.doorDeg).toBe(DOOR_MAX_DEG);
    expect(f.jamb).toBe(0);
    expect(f.opacity).toBe(0);
    expect(f.knocks).toBe(2);
  });

  it("draws the outer shape first, monotonically, before the split starts", () => {
    let prev = -1;
    for (let t = 0; t <= DRAW_OUTER_MS; t += 50) {
      const draw = computeIntro(t).drawOuter;
      expect(draw).toBeGreaterThanOrEqual(prev);
      prev = draw;
    }
    expect(computeIntro(DRAW_OUTER_MS).drawOuter).toBe(1);
    for (let t = 0; t < DRAW_SPLIT_START; t += 100) {
      expect(computeIntro(t).drawSplit).toBe(0);
    }
  });

  it("completes the center split before the texture beat begins", () => {
    expect(computeIntro(DRAW_SPLIT_START + DRAW_SPLIT_MS).drawSplit).toBe(1);
    for (let t = DRAW_SPLIT_START; t <= DRAW_SPLIT_START + DRAW_SPLIT_MS; t += 50) {
      const split = computeIntro(t).drawSplit;
      expect(split).toBeGreaterThanOrEqual(0);
      expect(split).toBeLessThanOrEqual(1);
    }
    expect(computeIntro(TEXTURE_START - 1).phase).toBe("draw");
    expect(computeIntro(TEXTURE_START).phase).toBe("texture");
  });

  it("fades in exactly two knocks inside the texture window", () => {
    expect(computeIntro(KNOCK_1_AT - 1).knocks).toBe(0);
    expect(computeIntro(KNOCK_1_AT).knocks).toBe(1);
    expect(computeIntro(KNOCK_2_AT - 1).knocks).toBe(1);
    expect(computeIntro(KNOCK_2_AT).knocks).toBe(2);
    expect(KNOCK_2_AT).toBeLessThanOrEqual(TEXTURE_START + TEXTURE_MS);
  });

  it("ramps the material to full walnut before the doors start opening", () => {
    expect(computeIntro(TEXTURE_START).texture).toBe(0);
    expect(computeIntro(TEXTURE_START + TEXTURE_MS / 2).texture).toBeGreaterThan(0);
    expect(computeIntro(TEXTURE_START + TEXTURE_MS).texture).toBe(1);
    expect(computeIntro(OPEN_START).texture).toBe(1);
    expect(computeIntro(OPEN_START).doorDeg).toBeLessThanOrEqual(0.0001);
  });

  it("swings the doors open between OPEN_START and REVEAL_START, jamb fading with them", () => {
    const mid = computeIntro(OPEN_START + (REVEAL_START - OPEN_START) / 2);
    expect(mid.doorDeg).toBeGreaterThan(0);
    expect(mid.doorDeg).toBeLessThan(DOOR_MAX_DEG);
    expect(mid.jamb).toBeGreaterThan(0);
    expect(mid.jamb).toBeLessThan(1);
    expect(computeIntro(REVEAL_START).phase).toBe("reveal");
    expect(computeIntro(REVEAL_START).doorDeg).toBeCloseTo(DOOR_MAX_DEG, 5);
    expect(computeIntro(REVEAL_START).jamb).toBeCloseTo(0, 5);
  });

  it("holds the reveal long enough for a wave, then fades to transparent by the end", () => {
    expect(REVEAL_START).toBeLessThan(FADE_START);
    expect(computeIntro(REVEAL_START + 200).opacity).toBe(1);
    expect(computeIntro(FADE_START).opacity).toBe(1);
    expect(computeIntro(FADE_START + 250).opacity).toBeLessThan(1);
    const nearEnd = computeIntro(INTRO_END - 10);
    expect(nearEnd.opacity).toBeLessThan(0.05);
    expect(nearEnd.opacity).toBeGreaterThan(0);
    expect(computeIntro(INTRO_END).opacity).toBe(0);
  });
});
