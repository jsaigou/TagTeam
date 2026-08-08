import type {
  CheatSheet,
  DocInput,
  GlossaryEntry,
  GroundingAnswer,
  GroundingQuestion,
  SimScript,
} from "@/shared/contract";
import { DEMO_GLOSSARY, DEMO_QUESTIONS, DEMO_SCRIPT, DEMO_SUMMARY } from "./demo-data";

/**
 * Thin wrapper around the ai-pipeline pure functions (src/lib/doc-parser.ts,
 * src/lib/sim-engine.ts, src/lib/cheat-sheet.ts). This file is the ONLY merge
 * point for ai-pipeline: modules are resolved lazily via import.meta.glob, so
 * once their files land the demo fallbacks below are replaced automatically.
 */

export type ParseResult = { summary: string; questions: GroundingQuestion[] };
export type SimResult = { script: SimScript; glossary: GlossaryEntry[] };

type DocParserModule = {
  docParser?: (doc: DocInput) => Promise<ParseResult> | ParseResult;
};
type SimEngineModule = {
  simEngine?: (
    summary: string | null,
    answers: GroundingAnswer[],
  ) => Promise<SimResult> | SimResult;
};
type CheatSheetModule = {
  cheatSheet?: (
    script: SimScript,
    glossary: GlossaryEntry[],
    answers: GroundingAnswer[],
  ) => Promise<CheatSheet> | CheatSheet;
};

const docParserGlob = import.meta.glob<DocParserModule>("../lib/doc-parser.ts");
const simEngineGlob = import.meta.glob<SimEngineModule>("../lib/sim-engine.ts");
const cheatSheetGlob = import.meta.glob<CheatSheetModule>("../lib/cheat-sheet.ts");

let docParser: DocParserModule["docParser"] | null = null;
let simEngine: SimEngineModule["simEngine"] | null = null;
let cheatSheet: CheatSheetModule["cheatSheet"] | null = null;

async function resolve<T>(
  glob: Record<string, () => Promise<T>>,
  suffix: string,
): Promise<T | null> {
  const key = Object.keys(glob).find((k) => k.endsWith(suffix));
  if (!key) return null;
  try {
    return (await glob[key]()) ?? null;
  } catch {
    return null;
  }
}

/** Resolves teammate modules at startup. Safe to call more than once. */
export async function initPipeline(): Promise<void> {
  const [dp, se, cs] = await Promise.all([
    resolve(docParserGlob, "doc-parser.ts"),
    resolve(simEngineGlob, "sim-engine.ts"),
    resolve(cheatSheetGlob, "cheat-sheet.ts"),
  ]);
  docParser = dp?.docParser ?? null;
  simEngine = se?.simEngine ?? null;
  cheatSheet = cs?.cheatSheet ?? null;
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export const pipeline = {
  async parseDoc(doc: DocInput): Promise<ParseResult> {
    if (docParser) return docParser(doc);
    await sleep(650);
    return { summary: DEMO_SUMMARY, questions: DEMO_QUESTIONS };
  },

  async runSim(
    summary: string | null,
    answers: GroundingAnswer[],
  ): Promise<SimResult> {
    if (simEngine) return simEngine(summary, answers);
    await sleep(700);
    return { script: DEMO_SCRIPT, glossary: DEMO_GLOSSARY };
  },

  async makeCheatSheet(
    script: SimScript,
    glossary: GlossaryEntry[],
    answers: GroundingAnswer[],
  ): Promise<CheatSheet> {
    if (cheatSheet) return cheatSheet(script, glossary, answers);
    await sleep(500);
    return deriveDemoCheatSheet(script, glossary);
  },
};

function deriveDemoCheatSheet(
  script: SimScript,
  glossary: GlossaryEntry[],
): CheatSheet {
  const phrases = script.turns
    .filter((t) => t.speaker === "bureaucrat" && t.vocab.length > 0)
    .slice(0, 5);
  const keyPhrases = phrases.map((t) => {
    const found = t.vocab.map((id) => glossary.find((g) => g.id === id));
    const entries = found.filter((e): e is GlossaryEntry => Boolean(e));
    return {
      jp: t.jp,
      furigana: entries.map((e) => e.furigana).join(" ・ "),
      en: t.en ?? "",
      when: entries.map((e) => e.en).join(" / "),
    };
  });

  const practice = script.turns
    .filter((t) => t.speaker === "user")
    .map((t) => `${t.jp}${t.en ? ` — ${t.en}` : ""}`);

  return {
    goal: script.scenarioTitle,
    keyPhrases,
    practice,
  };
}
