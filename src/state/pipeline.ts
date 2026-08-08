import type {
  CheatSheet,
  DocInput,
  GlossaryEntry,
  GroundingAnswer,
  GroundingQuestion,
  SimScript,
} from "@/shared/contract";
import {
  parseDocument,
  toGroundingQuestions,
  type DocSummary,
} from "@/lib/doc-parser";
import { generateSimulation } from "@/lib/sim-engine";
import { generateCheatSheet } from "@/lib/cheat-sheet";

export type ParseResult = {
  /** Human-readable summary string for the setup UI. */
  summary: string;
  /** Structured doc summary, passed through to simulation generation. */
  doc: DocSummary;
  questions: GroundingQuestion[];
};
export type SimResult = { script: SimScript; glossary: GlossaryEntry[] };

function summarize(doc: DocSummary): string {
  return [
    doc.documentType,
    doc.issuingAgency ? `Issued by ${doc.issuingAgency}` : "",
    doc.purpose,
    doc.keyFields.length ? `Key fields: ${doc.keyFields.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Thin wrapper around the ai-pipeline modules. No demo fallbacks. */
export const pipeline = {
  async parseDoc(doc: DocInput): Promise<ParseResult> {
    const parsed = await parseDocument(doc);
    return {
      summary: summarize(parsed),
      doc: parsed,
      questions: toGroundingQuestions(parsed),
    };
  },

  async runSim(
    _summary: string | null,
    answers: GroundingAnswer[],
    doc: DocSummary | null,
  ): Promise<SimResult> {
    if (!doc) {
      throw new Error("Document summary is missing — please go back and re-upload the document.");
    }
    return generateSimulation(doc, answers);
  },

  async makeCheatSheet(
    script: SimScript,
    glossary: GlossaryEntry[],
    answers: GroundingAnswer[],
  ): Promise<CheatSheet> {
    return generateCheatSheet({ script, glossary, answers });
  },
};
