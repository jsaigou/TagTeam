import { describe, expect, it } from "vitest";
import { pickKeyTerms } from "./key-terms";
import type { GlossaryEntry, SimScript } from "@/shared/contract";

const g = (id: string): GlossaryEntry => ({ id, kanji: id, furigana: id, en: id });

const script = (turnVocab: string[][]): SimScript => ({
  scenarioTitle: "t",
  turns: turnVocab.map((vocab, i) => ({
    id: `t${i}`,
    speaker: i % 2 === 0 ? "bureaucrat" : "user",
    jp: "x",
    vocab,
  })),
});

describe("pickKeyTerms", () => {
  it("prefers entries referenced by the script's turns", () => {
    // Referenced entries come first in GLOSSARY order (stable regardless of
    // where in the script they appear), then unreferenced padding.
    const out = pickKeyTerms([g("a"), g("b"), g("c"), g("d")], script([[], ["c"], [], ["a"]]));
    expect(out.map((e) => e.id)).toEqual(["a", "c", "b"]);
  });

  it("pads with unreferenced entries and caps at max", () => {
    const out = pickKeyTerms([g("a"), g("b"), g("c"), g("d")], script([["a"]]));
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(pickKeyTerms([g("a")], null)).toHaveLength(1);
  });

  it("handles empty inputs", () => {
    expect(pickKeyTerms([], null)).toEqual([]);
    expect(pickKeyTerms([], script([["a"]]))).toEqual([]);
  });
});
