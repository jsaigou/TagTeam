/**
 * Sprint 0 (Switchboard Plan) — offline batch audio-render pipeline for
 * prebuilt scenario module/vocab-pack lines (`ScenarioModuleLine`,
 * src/shared/contract.ts). Reuses `synthesizeSpeech()` from
 * server/providers.mjs — the exact BYO TTS call `presentWithAudio()` already
 * knows how to play — so a rendered clip is a drop-in for a fixed line, no
 * new playback path needed on the client.
 *
 * Idempotent: a line whose (id, voicePreset, text) hasn't changed since its
 * last render is skipped — the filename is content-hashed, so editing a
 * line's text naturally invalidates its stale audio instead of silently
 * leaving it stuck.
 *
 * This module holds the pure/testable planning + orchestration logic;
 * `scripts/render-scenario-audio.mjs` is the thin CLI that wires it to the
 * real filesystem and the real TTS provider. Neither has any scenario
 * content of its own yet — Sprint 1+ authors real module/vocab-pack lines
 * once they're native-checked (see the plan's Sprint 6 note on who owns
 * that QA).
 */
import { createHash } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/** @typedef {{ id: string, jp: string, voicePreset: string }} RenderLine */

/** Content-hashed so a line's stale audio is invalidated by editing its text
 *  or switching voice preset, not left silently out of date. */
export function outputFilename(line) {
  const hash = createHash("sha256").update(`${line.voicePreset}:${line.jp}`).digest("hex").slice(0, 16);
  return `${line.id}.${line.voicePreset}.${hash}.wav`;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Pure planning step: which lines actually need rendering, given what's
 *  already on disk. Separated from `renderAll` so a caller can preview a run
 *  (e.g. "12 to render, 40 unchanged") without touching the TTS provider. */
export async function planRender(lines, outDir, { exists = fileExists } = {}) {
  const plan = [];
  for (const line of lines) {
    const filename = outputFilename(line);
    const already = await exists(path.join(outDir, filename));
    plan.push({ line, filename, skip: already });
  }
  return plan;
}

/**
 * @param {RenderLine[]} lines
 * @param {{ outDir: string, synthesize: (text: string) => Promise<Buffer>, log?: (msg: string) => void }} opts
 * @returns {Promise<{ id: string, filename: string, rendered: boolean }[]>}
 */
export async function renderAll(lines, { outDir, synthesize, log = () => {} }) {
  await mkdir(outDir, { recursive: true });
  const plan = await planRender(lines, outDir);
  const results = [];
  for (const { line, filename, skip } of plan) {
    if (skip) {
      log(`skip   ${filename} (already rendered)`);
      results.push({ id: line.id, filename, rendered: false });
      continue;
    }
    log(`render ${filename}`);
    const audio = await synthesize(line.jp);
    await writeFile(path.join(outDir, filename), audio);
    results.push({ id: line.id, filename, rendered: true });
  }
  return results;
}
