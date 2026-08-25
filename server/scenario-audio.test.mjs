/**
 * server/scenario-audio.mjs — the offline batch audio-render pipeline
 * (Sprint 0, Switchboard Plan). Exercises real filesystem I/O against a
 * throwaway temp dir (fast, no mocking needed for pure fs calls); the only
 * injected dependency is `synthesize`, standing in for the real
 * synthesizeSpeech() (network + ffmpeg) so these tests never hit either.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { outputFilename, planRender, renderAll } from "./scenario-audio.mjs";

const LINES = [
  { id: "mod1.greeting", jp: "お電話ありがとうございます。", voicePreset: "standard" },
  { id: "mod5.closing", jp: "失礼いたします。", voicePreset: "formal" },
];

let outDir;

beforeEach(async () => {
  outDir = await mkdtemp(path.join(tmpdir(), "scenario-audio-test-"));
});

afterEach(async () => {
  await rm(outDir, { recursive: true, force: true });
});

describe("outputFilename", () => {
  it("is stable for the same (id, voicePreset, text)", () => {
    expect(outputFilename(LINES[0])).toBe(outputFilename({ ...LINES[0] }));
  });

  it("changes when the text or voice preset changes — stale audio can't hide", () => {
    const base = outputFilename(LINES[0]);
    expect(outputFilename({ ...LINES[0], jp: "different text" })).not.toBe(base);
    expect(outputFilename({ ...LINES[0], voicePreset: "friendly" })).not.toBe(base);
  });
});

describe("planRender", () => {
  it("marks every line for rendering when the output dir is empty", async () => {
    const plan = await planRender(LINES, outDir);
    expect(plan.every((p) => p.skip === false)).toBe(true);
    expect(plan.length).toBe(2);
  });
});

describe("renderAll", () => {
  it("renders every line once, writing real files via the injected synthesize fn", async () => {
    const synthesize = vi.fn(async (text) => Buffer.from(`WAV:${text}`));
    const results = await renderAll(LINES, { outDir, synthesize });

    expect(results.every((r) => r.rendered)).toBe(true);
    expect(synthesize).toHaveBeenCalledTimes(2);

    const files = await readdir(outDir);
    expect(files.length).toBe(2);
    const contents = await readFile(path.join(outDir, results[0].filename), "utf8");
    expect(contents).toBe(`WAV:${LINES[0].jp}`);
  });

  it("is idempotent: a second run with unchanged lines renders nothing new", async () => {
    const synthesize = vi.fn(async (text) => Buffer.from(`WAV:${text}`));
    await renderAll(LINES, { outDir, synthesize });
    synthesize.mockClear();

    const second = await renderAll(LINES, { outDir, synthesize });
    expect(second.every((r) => r.rendered === false)).toBe(true);
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("re-renders only the line whose text actually changed", async () => {
    const synthesize = vi.fn(async (text) => Buffer.from(`WAV:${text}`));
    await renderAll(LINES, { outDir, synthesize });
    synthesize.mockClear();

    const edited = [{ ...LINES[0], jp: "お電話ありがとうございます！新しい台詞。" }, LINES[1]];
    const results = await renderAll(edited, { outDir, synthesize });

    expect(synthesize).toHaveBeenCalledTimes(1);
    expect(results.find((r) => r.id === "mod1.greeting")?.rendered).toBe(true);
    expect(results.find((r) => r.id === "mod5.closing")?.rendered).toBe(false);
  });
});
