import { describe, expect, it } from "vitest";
import {
  computeDoors,
  DOOR_MAX_DEG,
  DRAW_MS,
  INTRO_END,
  OPEN_START,
  STROKE_SPANS,
  STROKES,
  TEXTURE_MS,
  TEXTURE_START,
} from "./timeline";

describe("doors demo timeline", () => {
  it("draws longest strokes first (target A order)", () => {
    const weights = STROKES.map((s) => s.weight);
    const sorted = [...weights].sort((a, b) => b - a);
    expect(weights).toEqual(sorted);
    expect(STROKE_SPANS.map((s) => s.key)).toEqual(STROKES.map((s) => s.key));
  });

  it("completes the whole drawing in ~1 second", () => {
    const last = STROKE_SPANS[STROKE_SPANS.length - 1];
    expect(last.start + last.dur).toBeCloseTo(DRAW_MS, 6);
  });

  it("gives each stroke its own window with no parallel strokes", () => {
    for (let i = 1; i < STROKE_SPANS.length; i++) {
      expect(STROKE_SPANS[i].start).toBeCloseTo(
        STROKE_SPANS[i - 1].start + STROKE_SPANS[i - 1].dur,
        6,
      );
      expect(STROKE_SPANS[i].dur).toBeGreaterThan(0);
    }
  });

  it("keeps stroke durations proportional to path length", () => {
    const byKey = Object.fromEntries(STROKE_SPANS.map((s) => [s.key, s]));
    expect(byKey.casing.dur / byKey.split.dur).toBeCloseTo(
      STROKES[0].weight / STROKES.find((s) => s.key === "split")!.weight,
      6,
    );
  });

  it("runs draw → texture → open → fade", () => {
    expect(computeDoors(DRAW_MS - 1).phase).toBe("draw");
    expect(computeDoors(TEXTURE_START + TEXTURE_MS - 1).phase).toBe("texture");
    expect(computeDoors(OPEN_START + 10).phase).toBe("open");
    expect(computeDoors(INTRO_END - 1).phase).toBe("fade");
  });

  it("clamps frame values at the boundaries", () => {
    const start = computeDoors(0);
    expect(start.strokes.every((p) => p === 0)).toBe(true);
    expect(start.texture).toBe(0);
    expect(start.doorDeg).toBe(0);

    const end = computeDoors(INTRO_END + 1000);
    expect(end.strokes.every((p) => p === 1)).toBe(true);
    expect(end.texture).toBe(1);
    expect(end.doorDeg).toBe(DOOR_MAX_DEG);
    expect(end.opacity).toBe(0);
  });

  it("is monotonic while drawing and never regresses progress", () => {
    let prev = -1;
    for (let t = 0; t <= DRAW_MS; t += 16) {
      const inked = computeDoors(t).strokes.reduce((a, p) => a + p, 0);
      expect(inked).toBeGreaterThanOrEqual(prev);
      prev = inked;
    }
  });
});
