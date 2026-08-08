/**
 * Document parser: turns a photo of a Japanese official document (DocInput)
 * into a structured {@link DocSummary} whose `questions` establish the phone
 * call objective as English GroundingQuestions.
 */
import type { DocInput, GroundingQuestion } from "../shared/contract";
import {
  buildImageUserContent,
  chatJson,
  isGroundingQuestionArray,
  isNonEmptyString,
  isStringArray,
  validateShape,
  type ChatMessage,
  type ChatOptions,
} from "./llm";
import { DOC_PARSE_SCHEMA_TEXT, DOC_PARSE_SYSTEM_PROMPT } from "../prompts/doc-parser";

/** Structured summary of the document, including 1-2 grounding questions. */
export type DocSummary = {
  documentType: string;
  issuingAgency: string;
  purpose: string;
  keyFields: string[];
  questions: GroundingQuestion[];
};

export type ParseDocumentOptions = {
  config?: ChatOptions["config"];
  timeoutMs?: number;
};

export const isDocSummary = (value: unknown): value is DocSummary =>
  validateShape<DocSummary>(
    value,
    {
      documentType: isNonEmptyString,
      issuingAgency: isNonEmptyString,
      purpose: isNonEmptyString,
      keyFields: isStringArray,
      questions: isGroundingQuestionArray,
    },
    ["documentType", "issuingAgency", "purpose", "keyFields", "questions"],
  );

/**
 * Send the document photo to the multimodal model and return a structured
 * summary. Defaults to a generous timeout for image analysis.
 */
export async function parseDocument(
  doc: DocInput,
  options: ParseDocumentOptions = {},
): Promise<DocSummary> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${DOC_PARSE_SYSTEM_PROMPT}\n\n【JSONスキーマ】\n${DOC_PARSE_SCHEMA_TEXT}`,
    },
    {
      role: "user",
      content: buildImageUserContent("この書類の写真を解析してください。", doc),
    },
  ];
  return chatJson(messages, isDocSummary, "DocSummary", {
    ...options,
    timeoutMs: options.timeoutMs ?? 120_000,
  });
}

/** Convenience accessor: the GroundingQuestions that establish the call objective. */
export function toGroundingQuestions(summary: DocSummary): GroundingQuestion[] {
  return summary.questions;
}
