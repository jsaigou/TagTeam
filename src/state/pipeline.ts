import type {
  CallSettings,
  CheatSheet,
  DocInput,
  GlossaryEntry,
  GroundingAnswer,
  GroundingQuestion,
  RoleId,
  SimScript,
} from "@/shared/contract";
import {
  parseDescription,
  parseDocument,
  toGroundingQuestions,
  type DocSummary,
} from "@/lib/doc-parser";
import { generateSimulation, inferRole } from "@/lib/sim-engine";
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
    const parsed =
      doc.kind === "text" ? await parseDescription(doc.text) : await parseDocument(doc);
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
    reference: string | null = null,
    settings?: CallSettings,
  ): Promise<SimResult> {
    if (!doc) {
      throw new Error("Document summary is missing — please go back and re-upload the document.");
    }
    return generateSimulation(doc, answers, {
      reference: reference ?? undefined,
      settings,
    });
  },

  async makeCheatSheet(
    script: SimScript,
    glossary: GlossaryEntry[],
    answers: GroundingAnswer[],
    reference?: string | null,
  ): Promise<CheatSheet> {
    return generateCheatSheet({ script, glossary, answers, reference: reference ?? undefined });
  },

  /** Infer which office staff member the caller should practice with. */
  async suggestRole(doc: DocSummary, answers: GroundingAnswer[]): Promise<RoleId> {
    return inferRole(doc, answers);
  },
};
