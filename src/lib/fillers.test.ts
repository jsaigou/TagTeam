import { describe, expect, it } from "vitest";
import { pickFiller } from "./fillers";

const EN_POOL = [
  "Hmm… Let me think…",
  "Hmmm… I see…",
  "Oooh… ok, ok…",
  "Almost ready…",
  "Let me look this up…",
  "Right, right…",
];

const JA_POOL = ["んんん…なるほど。", "あっ、そうですね。", "そろそろ出来ます。", "ええと…", "はいはい、少し待ってください。"];

describe("pickFiller", () => {
  it("returns a member of the English pool", () => {
    for (let i = 0; i < 50; i++) {
      expect(EN_POOL).toContain(pickFiller("en"));
    }
  });

  it("returns a member of the Japanese pool", () => {
    for (let i = 0; i < 50; i++) {
      expect(JA_POOL).toContain(pickFiller("ja"));
    }
  });

  it("never returns the avoided filler when the pool has >1 entry", () => {
    for (let i = 0; i < 200; i++) {
      const en = pickFiller("en", EN_POOL[0]);
      expect(en).not.toBe(EN_POOL[0]);
      const ja = pickFiller("ja", JA_POOL[2]);
      expect(ja).not.toBe(JA_POOL[2]);
    }
  });

  it("eventually varies without avoid", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(pickFiller("en"));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
