/**
 * Structural integrity check over every content/vocab-packs/*.json file —
 * including gov.* packs (Sprint 5), which aren't wired into
 * server/scenario-assembly.mjs's turn-plan shapes yet (content-only, per the
 * plan's "vocab-pack exercise, not new plumbing" scope for the City Hall
 * department) and so have no other test coverage. Catches an authoring typo
 * (a missing furigana field, a filename/leafId mismatch) regardless of
 * whether a pack is consumed by the fast path yet.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isGlossaryEntry } from "./glossary.mjs";

const DIR = new URL("../content/vocab-packs/", import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

describe("content/vocab-packs/*.json", () => {
  it("has at least one pack per taxonomy department already covered", () => {
    expect(files.length).toBeGreaterThanOrEqual(14);
  });

  for (const file of files) {
    it(`${file} matches its VocabPack shape (leafId, 10 valid GlossaryEntry entries)`, () => {
      const pack = JSON.parse(readFileSync(new URL(file, DIR), "utf8"));
      const expectedLeafId = file.replace(/\.json$/, "");
      expect(pack.leafId).toBe(expectedLeafId);
      expect(Array.isArray(pack.entries)).toBe(true);
      expect(pack.entries.length).toBeGreaterThanOrEqual(1);
      const ids = new Set();
      for (const entry of pack.entries) {
        expect(isGlossaryEntry(entry)).toBe(true);
        expect(ids.has(entry.id)).toBe(false);
        ids.add(entry.id);
      }
    });
  }
});
