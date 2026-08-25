#!/usr/bin/env node
/**
 * Sprint 0 (Switchboard Plan) — CLI entrypoint for the offline audio-render
 * pipeline. Thin by design: all the actual logic (what needs (re)rendering,
 * writing files) lives in server/scenario-audio.mjs, tested without network
 * or real TTS. This file just wires that logic to argv, the real filesystem,
 * and the real BYO TTS provider (server/providers.mjs).
 *
 * Usage:
 *   node --env-file=.env scripts/render-scenario-audio.mjs <lines.json> [outDir]
 *
 * <lines.json> is a JSON array of ScenarioModuleLine-shaped objects
 * ({ id, jp, voicePreset }, src/shared/contract.ts). outDir defaults to
 * content/scenario-audio/ at the repo root. Requires TTS_PROVIDER=byo (see
 * SETUP.md) — synthesizeSpeech() throws a clear error otherwise.
 */
import { readFile } from "node:fs/promises";
import { renderAll } from "../server/scenario-audio.mjs";

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/render-scenario-audio.mjs <lines.json> [outDir]");
    process.exitCode = 1;
    return;
  }
  const outDir =
    process.argv[3] ?? new URL("../content/scenario-audio/", import.meta.url).pathname;

  const lines = JSON.parse(await readFile(inputPath, "utf8"));
  const { synthesizeSpeech } = await import("../server/providers.mjs");

  const results = await renderAll(lines, {
    outDir,
    synthesize: (text) => synthesizeSpeech(text, { language: "ja" }),
    log: (msg) => console.log(msg),
  });

  const rendered = results.filter((r) => r.rendered).length;
  console.log(`Done: ${rendered} rendered, ${results.length - rendered} skipped, out -> ${outDir}`);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exitCode = 1;
});
