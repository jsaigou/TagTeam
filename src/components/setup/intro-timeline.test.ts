import { describe, expect, it } from "vitest";

import {
  computeIntro,
  DOOR_MAX_DEG,
  DRAW_MS,
  FADE_START,
  INTRO_END,
  KNOCK_1_AT,
  KNOCK_2_AT,
  OPEN_START,
  REVEAL_START,
} from "./intro-timeline";

describe("computeIntro", () => {
  it("starts fully closed and undrawn", () => {
    const f = computeIntro(0);
    expect(f.phase).toBe("draw");
    expect(f.draw).toBe(0);
    expect(f.fill).toBe(0);
    expect(f.doorDeg).toBe(0);
    expect(f.jamb).toBe(1);
    expect(f.opacity).toBe(1);
    expect(f.knocks).toBe(0);
  });

  it("finishes fully open, faded out, both knocks fired — the skip target", () => {
    const f = computeIntro(INTRO_END + 5000);
    expect(f.draw).toBe(1);
    expect(f.fill).toBe(1);
    expect(f.doorDeg).toBe(DOOR_MAX_DEG);
    expect(f.jamb).toBe(0);
    expect(f.opacity).toBe(0);
    expect(f.knocks).toBe(2);
  });

  it("draws monotonically and completes before the first knock", () => {
    let prev = -1;
    for (let t = 0; t <= DRAW_MS; t += 100) {
      const draw = computeIntro(t).draw;
      expect(draw).toBeGreaterThanOrEqual(prev);
      prev = draw;
    }
    expect(computeIntro(DRAW_MS).draw).toBe(1);
    expect(computeIntro(KNOCK_1_AT).phase).toBe("knock");
  });

  it("fires exactly two knocks at their scheduled times", () => {
    expect(computeIntro(KNOCK_1_AT - 1).knocks).toBe(0);
    expect(computeIntro(KNOCK_1_AT).knocks).toBe(1);
    expect(computeIntro(KNOCK_2_AT - 1).knocks).toBe(1);
    expect(computeIntro(KNOCK_2_AT).knocks).toBe(2);
  });

  it("solidifies the door fill during the knock phase, before opening", () => {
    expect(computeIntro(KNOCK_1_AT).fill).toBeGreaterThanOrEqual(0);
    expect(computeIntro(OPEN_START).fill).toBe(1);
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

  it("stays opaque through the reveal and fades to transparent by the end", () => {
    expect(computeIntro(FADE_START).opacity).toBe(1);
    expect(computeIntro(FADE_START + 250).opacity).toBeLessThan(1);
    const nearEnd = computeIntro(INTRO_END - 10);
    expect(nearEnd.opacity).toBeLessThan(0.05);
    expect(nearEnd.opacity).toBeGreaterThan(0);
  });
});
