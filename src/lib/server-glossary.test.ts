/**
 * Parity tests for `server/glossary.mjs`, the Phase 7b port of
 * `src/lib/glossary.ts` + the isTurn/isGlossaryEntry/isSimulationRaw
 * validators in `src/lib/llm.ts` (see the Phase 7 plan §7b.5 migration step
 * 4 — "port the client validators ... rather than re-deriving them"). Mirrors
 * `glossary.test.ts`'s cases against the server copy to prove the port
 * behaves identically, plus the isSimulationRaw shape checks that file
 * doesn't cover.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error server .mjs modules ship without type declarations
import { extractGlossary, glossaryById, isSimulationRaw, reconcileScript, reconcileSimulation } from "../../server/glossary.mjs";
import { SIM_FIXTURE } from "../fixtures/llm";
import type { GlossaryEntry, SimScript } from "../shared/contract";

describe("server/glossary.mjs extractGlossary", () => {
  it("extracts valid entries, drops invalid ones and dedupes by id", () => {
    const entries: GlossaryEntry[] = [
      ...SIM_FIXTURE.glossary,
      { id: "g1", kanji: "duplicate", furigana: "dup", en: "dup" },
      { id: "", kanji: "", furigana: "", en: "invalid" },
    ];
    const out = extractGlossary(entries);
    expect(out).toHaveLength(SIM_FIXTURE.glossary.length);
    expect(out.find((g: GlossaryEntry) => g.id === "g1")?.kanji).toBe("医療費のお知らせ");
  });

  it("keeps the first occurrence when ids collide", () => {
    const out = extractGlossary([
      { id: "g1", kanji: "first", furigana: "a", en: "a" },
      { id: "g1", kanji: "second", furigana: "b", en: "b" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].kanji).toBe("first");
  });
});

describe("server/glossary.mjs glossaryById", () => {
  it("builds an id -> entry map", () => {
    const map = glossaryById(SIM_FIXTURE.glossary);
    expect(map.size).toBe(SIM_FIXTURE.glossary.length);
    expect(map.get("g1")?.kanji).toBe("医療費のお知らせ");
  });
});

describe("server/glossary.mjs reconcileScript", () => {
  it("passes a well-formed script through unchanged", () => {
    const out = reconcileScript(SIM_FIXTURE.script, SIM_FIXTURE.glossary);
    expect(out).toEqual(SIM_FIXTURE.script);
  });

  it("drops vocab ids that are not present in the glossary", () => {
    const script: SimScript = {
      ...SIM_FIXTURE.script,
      turns: SIM_FIXTURE.script.turns.map((turn, i) =>
        i === 0 ? { ...turn, vocab: [...turn.vocab, "g999", "missing"] } : turn,
      ),
    };
    const out = reconcileScript(script, SIM_FIXTURE.glossary);
    expect(out.turns[0].vocab).toEqual(SIM_FIXTURE.script.turns[0].vocab);
  });

  it("trims leading user turns so the call opens with the bureaucrat", () => {
    const script: SimScript = {
      scenarioTitle: "x",
      turns: [
        { id: "u0", speaker: "user", jp: "Hello?", vocab: [] },
        ...SIM_FIXTURE.script.turns,
      ],
    };
    const out = reconcileScript(script, SIM_FIXTURE.glossary);
    expect(out.turns[0].speaker).toBe("bureaucrat");
    expect(out.turns).toHaveLength(SIM_FIXTURE.script.turns.length);
  });

  it("throws rather than emitting a script that starts with user turns", () => {
    const turns = Array.from({ length: 10 }, (_, i) => {
      const speaker = i < 5 ? ("user" as const) : ("bureaucrat" as const);
      return { id: `t${i + 1}`, speaker, jp: String.fromCharCode(65 + i), vocab: [] as string[] };
    });
    // All 5 surviving turns are "bureaucrat" (no user turns follow), so
    // alternation collapses them to 1 before the 6-turn-minimum check fires
    // — same behavior as the client copy (glossary.test.ts asserts the same
    // fixture generically via `toThrow(LlmError)`; here the message pins it).
    expect(() => reconcileScript({ scenarioTitle: "x", turns }, [])).toThrow(/6-10 turns/);
  });

  it("enforces alternation and clamps to 10 turns", () => {
    const base = [
      { id: "b1", speaker: "bureaucrat" as const, jp: "A", vocab: [] as string[] },
      { id: "u1", speaker: "user" as const, jp: "B", vocab: [] as string[] },
    ];
    const turns = Array.from({ length: 20 }, (_, i) => ({
      ...base[i % 2],
      id: `t${i + 1}`,
    }));
    const out = reconcileScript({ scenarioTitle: "x", turns }, []);
    expect(out.turns).toHaveLength(10);
    for (let i = 1; i < out.turns.length; i += 1) {
      expect(out.turns[i].speaker).not.toBe(out.turns[i - 1].speaker);
    }
  });

  it("throws when fewer than 6 turns survive", () => {
    const script: SimScript = {
      scenarioTitle: "x",
      turns: [
        { id: "b1", speaker: "bureaucrat", jp: "A", vocab: [] },
        { id: "u1", speaker: "user", jp: "B", vocab: [] },
      ],
    };
    expect(() => reconcileScript(script, [])).toThrow(/6-10 turns/);
  });
});

describe("server/glossary.mjs reconcileSimulation", () => {
  it("reconciles script + glossary together", () => {
    const raw = {
      script: {
        scenarioTitle: "x",
        turns: [
          { id: "u0", speaker: "user" as const, jp: "hi", vocab: ["g1", "g999"] as string[] },
          { id: "b1", speaker: "bureaucrat" as const, jp: "A", vocab: ["g1"] as string[] },
          { id: "u1", speaker: "user" as const, jp: "B", vocab: [] as string[] },
          { id: "b2", speaker: "bureaucrat" as const, jp: "C", vocab: [] as string[] },
          { id: "u2", speaker: "user" as const, jp: "D", vocab: [] as string[] },
          { id: "b3", speaker: "bureaucrat" as const, jp: "E", vocab: [] as string[] },
          { id: "u3", speaker: "user" as const, jp: "F", vocab: [] as string[] },
          { id: "b4", speaker: "bureaucrat" as const, jp: "G", vocab: [] as string[] },
        ],
      } as SimScript,
      glossary: [
        { id: "g1", kanji: "書類", furigana: "しょるい", en: "document" },
        { id: "g1", kanji: "dup", furigana: "d", en: "d" },
        { id: "g2", kanji: "窓口", furigana: "まどぐち", en: "counter" },
      ],
    };
    const out = reconcileSimulation(raw);
    expect(out.glossary.map((g: GlossaryEntry) => g.id)).toEqual(["g1", "g2"]);
    expect(out.script.turns[0].speaker).toBe("bureaucrat");
    expect(out.script.turns[0].vocab).toEqual(["g1"]);
    expect(out.script.turns).toHaveLength(7);
  });
});

describe("server/glossary.mjs isSimulationRaw", () => {
  it("accepts a well-formed script+glossary payload", () => {
    expect(
      isSimulationRaw({
        scenarioTitle: SIM_FIXTURE.script.scenarioTitle,
        turns: SIM_FIXTURE.script.turns,
        glossary: SIM_FIXTURE.glossary,
      }),
    ).toBe(true);
  });

  it("rejects a payload missing glossary", () => {
    expect(
      isSimulationRaw({ scenarioTitle: "x", turns: SIM_FIXTURE.script.turns }),
    ).toBe(false);
  });

  it("rejects a turn with no id or speaker", () => {
    expect(
      isSimulationRaw({
        scenarioTitle: "x",
        turns: [{ jp: "hi", vocab: [] }],
        glossary: [],
      }),
    ).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(isSimulationRaw(null)).toBe(false);
    expect(isSimulationRaw("nope")).toBe(false);
  });
});
