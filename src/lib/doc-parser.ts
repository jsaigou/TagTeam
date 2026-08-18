/**
 * Document parser: turns a photo of a Japanese official document (DocInput)
 * into a structured {@link DocSummary} whose `questions` establish the phone
 * call objective as English GroundingQuestions.
 */
import type { GroundingQuestion, ImageDoc, ImagesDoc } from "../shared/contract";
import {
  buildImagesUserContent,
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
 * Send one or more document photos to the multimodal model and return a
 * structured summary. Defaults to a generous timeout for image analysis.
 */
export async function parseDocument(
  doc: ImageDoc | ImagesDoc,
  options: ParseDocumentOptions = {},
): Promise<DocSummary> {
  const images: ImageDoc[] = doc.kind === "images" ? doc.images : [doc];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${DOC_PARSE_SYSTEM_PROMPT}\n\n【JSONスキーマ】\n${DOC_PARSE_SCHEMA_TEXT}`,
    },
    {
      role: "user",
      content: buildImagesUserContent("この書類の写真を解析してください。", images),
    },
  ];
  return chatJson(messages, isDocSummary, "DocSummary", {
    ...options,
    timeoutMs: options.timeoutMs ?? 120_000,
  });
}

/**
 * Parse a free-text description of the issue/scenario (no photo). Same schema
 * and grounding questions as the image path.
 */
export async function parseDescription(
  text: string,
  options: ParseDocumentOptions = {},
): Promise<DocSummary> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${DOC_PARSE_SYSTEM_PROMPT}\n\n【JSONスキーマ】\n${DOC_PARSE_SCHEMA_TEXT}`,
    },
    {
      role: "user",
      content: `【利用者の状況説明】\n${text}\n\n上記の状況を分析し、指定されたJSONスキーマに従って文書が存在する場合と同様に、documentType / issuingAgency / purpose / keyFields / questions を抽出してください。写真はありません。回答は必ずJSONオブジェクトで返してください。`,
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
