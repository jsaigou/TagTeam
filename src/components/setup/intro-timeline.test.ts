import { describe, expect, it } from "vitest";

import {
  computeIntro,
  DOOR_MAX_DEG,
  DRAW_END_MS,
  FADE_START,
  INTRO_END,
  KNOCK_1_AT,
  KNOCK_2_AT,
  OPEN_START,
  REVEAL_START,
  STROKE_INDEX,
  STROKE_SPANS,
  STROKES,
  TEXTURE_MS,
  TEXTURE_START,
} from "./intro-timeline";

describe("stroke plan", () => {
  it("draws strictly one stroke at a time — each starts only when the previous ends", () => {
    for (let i = 1; i < STROKE_SPANS.length; i++) {
      const prev = STROKE_SPANS[i - 1];
      const cur = STROKE_SPANS[i];
      expect(cur.start).toBeGreaterThanOrEqual(prev.start + prev.dur);
    }
  });

  it("draws longest continuous lines first", () => {
    const weights = STROKES.map((s) => s.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(STROKES[0].key).toBe("casing");
    // Knobs are the shortest lines and land last.
    const order = STROKES.map((s) => s.key);
    expect(order.slice(-2).sort()).toEqual(["knobL", "knobR"]);
  });

  it("completes the whole drawing in about one second", () => {
    const last = STROKE_SPANS[STROKE_SPANS.length - 1];
    expect(last.start + last.dur).toBeCloseTo(DRAW_END_MS, 6);
    expect(DRAW_END_MS).toBeLessThanOrEqual(1100);
  });

  it("gives longer strokes proportionally more time (constant hand speed)", () => {
    for (const span of STROKE_SPANS) {
      const weight = STROKES[STROKE_INDEX[span.key]].weight;
      expect(span.dur / weight).toBeCloseTo(
        STROKE_SPANS[0].dur / STROKES[0].weight,
        5,
      );
    }
  });
});

describe("computeIntro", () => {
  it("starts fully closed and undrawn", () => {
    const f = computeIntro(0);
    expect(f.phase).toBe("draw");
    expect(f.strokes.every((s) => s === 0)).toBe(true);
    expect(f.inked).toBe(0);
    expect(f.texture).toBe(0);
    expect(f.doorDeg).toBe(0);
    expect(f.jamb).toBe(1);
    expect(f.opacity).toBe(1);
    expect(f.knocks).toBe(0);
  });

  it("holds the opaque backing through the whole draw, fading only as doors open", () => {
    for (let t = 1; t < OPEN_START; t += 200) {
      expect(computeIntro(t).jamb).toBe(1);
    }
  });

  it("finishes fully open, textured, faded out, both knocks fired — the skip target", () => {
    const f = computeIntro(INTRO_END + 5000);
    expect(f.strokes.every((s) => s === 1)).toBe(true);
    expect(f.inked).toBe(1);
    expect(f.texture).toBe(1);
    expect(f.doorDeg).toBe(DOOR_MAX_DEG);
    expect(f.jamb).toBe(0);
    expect(f.opacity).toBe(0);
    expect(f.knocks).toBe(2);
  });

  it("has exactly one stroke mid-draw at any moment (single hand)", () => {
    for (let t = 1; t < DRAW_END_MS; t += 25) {
      const active = computeIntro(t).strokes.filter((p) => p > 0 && p < 1);
      expect(active.length).toBeLessThanOrEqual(1);
    }
  });

  it("completes every stroke before the texture beat begins", () => {
    expect(computeIntro(DRAW_END_MS).strokes.every((s) => s === 1)).toBe(true);
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

  it("exposes a plan index for every stroke key DoorsIntro renders", () => {
    for (const key of STROKES.map((s) => s.key)) {
      expect(STROKE_INDEX[key]).toBeDefined();
      expect(STROKE_SPANS[STROKE_INDEX[key]].key).toBe(key);
    }
  });
});
