/**
 * Phase 7b job step — the server-side migration of `src/lib/doc-parser.ts`'s
 * `parseDocument` + `parseDescription` (Phase 7 plan §7b.5 migration step 5):
 * a document photo (or a free-text description of the situation) becomes a
 * structured DocSummary whose `questions` establish the phone-call objective.
 * Ported rather than re-derived: the system prompt/schema mirror
 * `server/prompts/doc-parser.mjs` and the response validation mirrors
 * `server/doc-parser.mjs` (both ports of the client copies — see those
 * files' headers).
 *
 * Unlike every other step so far (pure env singletons like `llmChat`), this
 * one needs an injected instance — the ephemeral upload store
 * (`server/hub.mjs#createUploadStore`) where `POST /api/uploads` bytes
 * already live — so it ships as a factory:
 * `createParseDocumentStep({ uploadStore })` returns the usual `{ step }`
 * shape. The job input carries uploadIds only; the image bytes themselves
 * never enter the graph context.
 */
import { llmChat } from "../providers.mjs";
import { DOC_PARSE_SCHEMA_TEXT, DOC_PARSE_SYSTEM_PROMPT } from "../prompts/doc-parser.mjs";
import { isDocSummary } from "../doc-parser.mjs";

/** Mirrors `parseJsonObject`'s fenced-code-block tolerance (`src/lib/llm.ts`). */
function parseJsonContent(content) {
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1];
  return JSON.parse(text);
}

/** Mirrors `parseDescription`'s user message (`src/lib/doc-parser.ts`). */
function descriptionUserContent(text) {
  return `【利用者の状況説明】\n${text}\n\n上記の状況を分析し、指定されたJSONスキーマに従って文書が存在する場合と同様に、documentType / issuingAgency / purpose / keyFields / questions を抽出してください。写真はありません。回答は必ずJSONオブジェクトで返してください。`;
}

/** Mirrors `buildImagesUserContent` (`src/lib/llm.ts`): one text part, then
 *  one `image_url` content part per page, all in a single user message. */
function imagesUserContent(text, dataUrls) {
  return [
    { type: "text", text },
    ...dataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
}

/**
 * @param {object} opts
 * @param {ReturnType<import("../hub.mjs").createUploadStore>} opts.uploadStore
 */
export function createParseDocumentStep({ uploadStore } = {}) {
  if (!uploadStore) throw new Error("createParseDocumentStep requires `uploadStore`");

  /** Resolve one uploadId to a base64 data URL, or 400 if expired/missing. */
  function dataUrlFor(uploadId, mimeTypeHint) {
    const record = uploadStore.get(uploadId);
    if (!record) {
      throw Object.assign(new Error("Upload not found or expired — please try again."), {
        status: 400,
      });
    }
    const mimeType = record.mimeType || mimeTypeHint || "image/jpeg";
    return `data:${mimeType};base64,${record.buffer.toString("base64")}`;
  }

  /**
   * @param {{ doc: { kind: "text", text: string }
   *           | { kind: "image", uploadId: string, mimeType?: string }
   *           | { kind: "images", uploadIds: string[] } }} input
   */
  async function run({ doc }, { signal, report }) {
    if (!doc || typeof doc !== "object" || typeof doc.kind !== "string") {
      throw Object.assign(new Error("No document given to parse."), { status: 400 });
    }
    const system = `${DOC_PARSE_SYSTEM_PROMPT}\n\n【JSONスキーマ】\n${DOC_PARSE_SCHEMA_TEXT}`;
    let messages;
    let uploadIds = [];

    if (doc.kind === "text") {
      const text = String(doc.text ?? "").trim();
      if (!text) {
        throw Object.assign(new Error("No document description given."), { status: 400 });
      }
      messages = [
        { role: "system", content: system },
        { role: "user", content: descriptionUserContent(text) },
      ];
    } else if (doc.kind === "image") {
      if (typeof doc.uploadId !== "string" || !doc.uploadId) {
        throw Object.assign(new Error("No document upload given to parse."), { status: 400 });
      }
      uploadIds = [doc.uploadId];
      report({ detail: "Fetching the document photo…", progress: 0.1 });
      const dataUrl = dataUrlFor(doc.uploadId, doc.mimeType);
      messages = [
        { role: "system", content: system },
        { role: "user", content: imagesUserContent("この書類の写真を解析してください。", [dataUrl]) },
      ];
    } else if (doc.kind === "images") {
      uploadIds = Array.isArray(doc.uploadIds)
        ? doc.uploadIds.filter((id) => typeof id === "string" && id)
        : [];
      if (!uploadIds.length) {
        throw Object.assign(new Error("No document pages given to parse."), { status: 400 });
      }
      report({ detail: "Fetching the document pages…", progress: 0.1 });
      const dataUrls = uploadIds.map((id) => dataUrlFor(id));
      messages = [
        { role: "system", content: system },
        { role: "user", content: imagesUserContent("この書類の写真を解析してください。", dataUrls) },
      ];
    } else {
      throw Object.assign(new Error(`Unknown document kind "${doc.kind}".`), { status: 400 });
    }

    report({ detail: "Reading your document…", progress: 0.3 });
    // No maxTokens override — providers.mjs's 8192 default is deliberately
    // generous (see identifyTarget.mjs's note on the deployed reasoning model
    // burning its budget on hidden reasoning_content before `content`).
    const res = await llmChat(messages, {
      temperature: 0.2,
      responseFormat: { type: "json_object" },
      signal,
    });
    const content = res.choices?.[0]?.message?.content ?? "";
    let parsed;
    try {
      parsed = parseJsonContent(content);
    } catch {
      throw Object.assign(new Error("Could not read that document."), { status: 502 });
    }
    if (!isDocSummary(parsed)) {
      throw Object.assign(new Error("Could not read that document."), { status: 502 });
    }

    report({ detail: "Checking the summary…", progress: 0.9 });
    // Success-path-only cleanup: jobs.mjs retries once on a validation-style
    // failure, and the retry still needs the bytes. Failed/abandoned uploads
    // are the 10-minute TTL sweep's job.
    for (const uploadId of uploadIds) uploadStore.remove(uploadId);
    return parsed;
  }

  return {
    step: {
      lane: "llm",
      // 150s per the Phase 7 plan §7b.6 deadline model for llm-lane steps —
      // multimodal analysis of up to a full document bundle is at least as
      // much model work as planScenario.
      attemptMs: 150_000,
      label: "Reading your document…",
      run,
    },
    run,
  };
}
