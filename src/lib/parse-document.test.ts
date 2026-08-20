/**
 * `server/steps/parseDocument.mjs` — the Phase 7b server-side migration of
 * `src/lib/doc-parser.ts`'s `parseDocument`/`parseDescription` (Phase 7 plan
 * §7b.5 migration step 5). `llmChat` is mocked (same style as
 * `plan-scenario.test.ts`); the ported validator itself is covered by
 * `server-doc-parser.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOC_IMAGE_DATA_URL } from "../fixtures/doc-image";
import { DOC_SUMMARY_FIXTURE, DOC_SUMMARY_JSON } from "../fixtures/llm";

const llmChat = vi.fn();
vi.mock("../../server/providers.mjs", () => ({ llmChat: (...args: unknown[]) => llmChat(...args) }));

// @ts-expect-error server .mjs modules ship without type declarations
const { createParseDocumentStep } = await import("../../server/steps/parseDocument.mjs");
// @ts-expect-error server .mjs modules ship without type declarations
const { DOC_PARSE_SYSTEM_PROMPT, DOC_PARSE_SCHEMA_TEXT } = await import("../../server/prompts/doc-parser.mjs");

const PNG_BUFFER = Buffer.from(DOC_IMAGE_DATA_URL.replace(/^data:image\/png;base64,/, ""), "base64");

/** Minimal stand-in for server/hub.mjs's createUploadStore (get/remove are
 *  the only members the step touches; create seeds test records). */
function fakeUploadStore() {
  const items = new Map<string, { buffer: Buffer; mimeType: string }>();
  return {
    seed(uploadId: string, buffer = PNG_BUFFER, mimeType = "image/png") {
      items.set(uploadId, { buffer, mimeType });
    },
    has: (uploadId: string) => items.has(uploadId),
    get: vi.fn((uploadId: string) => items.get(uploadId) ?? null),
    remove: vi.fn((uploadId: string) => items.delete(uploadId)),
  };
}

function chatResult(content: string) {
  return { choices: [{ message: { content } }] };
}

/** The exact user message `parseDescription` builds client-side. */
const DESCRIPTION_CONTENT = (text: string) =>
  `【利用者の状況説明】\n${text}\n\n上記の状況を分析し、指定されたJSONスキーマに従って文書が存在する場合と同様に、documentType / issuingAgency / purpose / keyFields / questions を抽出してください。写真はありません。回答は必ずJSONオブジェクトで返してください。`;

const report = vi.fn();
const ctx = { signal: new AbortController().signal, report };

let store: ReturnType<typeof fakeUploadStore>;
let run: (input: unknown, ctx: unknown) => Promise<unknown>;

beforeEach(() => {
  llmChat.mockReset();
  report.mockReset();
  store = fakeUploadStore();
  ({ run } = createParseDocumentStep({ uploadStore: store }) as {
    run: (input: unknown, ctx: unknown) => Promise<unknown>;
  });
});

describe("parseDocument run() — text kind", () => {
  it("builds the description prompt and returns the parsed summary", async () => {
    llmChat.mockResolvedValue(chatResult(DOC_SUMMARY_JSON));
    const result = await run({ doc: { kind: "text", text: "I got a notice about medical expenses" } }, ctx);

    expect(result).toEqual(DOC_SUMMARY_FIXTURE);
    const [messages, options] = llmChat.mock.calls[0];
    expect(messages[0]).toEqual({
      role: "system",
      content: `${DOC_PARSE_SYSTEM_PROMPT}\n\n【JSONスキーマ】\n${DOC_PARSE_SCHEMA_TEXT}`,
    });
    expect(messages[1]).toEqual({
      role: "user",
      content: DESCRIPTION_CONTENT("I got a notice about medical expenses"),
    });
    expect(options).toMatchObject({ responseFormat: { type: "json_object" } });
    expect(options.maxTokens).toBeUndefined();
    expect(store.get).not.toHaveBeenCalled();
  });

  it("rejects an empty description with a 400 before calling the LLM", async () => {
    await expect(run({ doc: { kind: "text", text: "   " } }, ctx)).rejects.toMatchObject({ status: 400 });
    expect(llmChat).not.toHaveBeenCalled();
  });
});

describe("parseDocument run() — image kind", () => {
  it("fetches the upload, sends it as an image_url content part, and returns the summary", async () => {
    store.seed("u1");
    llmChat.mockResolvedValue(chatResult(DOC_SUMMARY_JSON));

    const result = await run({ doc: { kind: "image", uploadId: "u1" } }, ctx);

    expect(result).toEqual(DOC_SUMMARY_FIXTURE);
    expect(store.get).toHaveBeenCalledWith("u1");
    const [messages] = llmChat.mock.calls[0];
    expect(messages[1].content).toEqual([
      { type: "text", text: "この書類の写真を解析してください。" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BUFFER.toString("base64")}` } },
    ]);
  });

  it("removes the upload from the store after a successful parse", async () => {
    store.seed("u1");
    llmChat.mockResolvedValue(chatResult(DOC_SUMMARY_JSON));
    await run({ doc: { kind: "image", uploadId: "u1" } }, ctx);
    expect(store.remove).toHaveBeenCalledWith("u1");
    expect(store.has("u1")).toBe(false);
  });

  it("throws a 400 (and never calls the LLM) when the upload expired", async () => {
    await expect(run({ doc: { kind: "image", uploadId: "gone" } }, ctx)).rejects.toMatchObject({
      status: 400,
      message: /Upload not found or expired/,
    });
    expect(llmChat).not.toHaveBeenCalled();
    expect(store.remove).not.toHaveBeenCalled();
  });
});

describe("parseDocument run() — images kind", () => {
  it("sends every page in one multimodal user message and cleans up all uploads", async () => {
    store.seed("p1");
    store.seed("p2", Buffer.from([1, 2, 3]), "image/jpeg");
    llmChat.mockResolvedValue(chatResult(DOC_SUMMARY_JSON));

    const result = await run({ doc: { kind: "images", uploadIds: ["p1", "p2"] } }, ctx);

    expect(result).toEqual(DOC_SUMMARY_FIXTURE);
    const [messages] = llmChat.mock.calls[0];
    expect(messages[1].content).toEqual([
      { type: "text", text: "この書類の写真を解析してください。" },
      { type: "image_url", image_url: { url: `data:image/png;base64,${PNG_BUFFER.toString("base64")}` } },
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } },
    ]);
    expect(store.remove).toHaveBeenCalledTimes(2);
    expect(store.remove).toHaveBeenCalledWith("p1");
    expect(store.remove).toHaveBeenCalledWith("p2");
  });

  it("rejects with a 400 when any page is missing, without touching the LLM", async () => {
    store.seed("p1");
    await expect(run({ doc: { kind: "images", uploadIds: ["p1", "missing"] } }, ctx)).rejects.toMatchObject({
      status: 400,
    });
    expect(llmChat).not.toHaveBeenCalled();
    // Failed parses never clean up — the retry (or the TTL sweep) still
    // needs the bytes.
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.has("p1")).toBe(true);
  });

  it("rejects an empty uploadIds list with a 400", async () => {
    await expect(run({ doc: { kind: "images", uploadIds: [] } }, ctx)).rejects.toMatchObject({ status: 400 });
    expect(llmChat).not.toHaveBeenCalled();
  });
});

describe("parseDocument run() — LLM reply handling", () => {
  beforeEach(() => {
    store.seed("u1");
  });

  it("tolerates a fenced JSON code block", async () => {
    llmChat.mockResolvedValue(chatResult(`\`\`\`json\n${DOC_SUMMARY_JSON}\n\`\`\``));
    const result = await run({ doc: { kind: "image", uploadId: "u1" } }, ctx);
    expect(result).toEqual(DOC_SUMMARY_FIXTURE);
    expect(store.remove).toHaveBeenCalledWith("u1");
  });

  it("rejects invalid JSON with a 502 and keeps the upload for the retry", async () => {
    llmChat.mockResolvedValue(chatResult("not json"));
    await expect(run({ doc: { kind: "image", uploadId: "u1" } }, ctx)).rejects.toMatchObject({ status: 502 });
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.has("u1")).toBe(true);
  });

  it("rejects a reply that fails the DocSummary schema with a 502 and keeps the upload", async () => {
    llmChat.mockResolvedValue(chatResult(JSON.stringify({ documentType: "x" })));
    await expect(run({ doc: { kind: "image", uploadId: "u1" } }, ctx)).rejects.toMatchObject({ status: 502 });
    expect(store.remove).not.toHaveBeenCalled();
    expect(store.has("u1")).toBe(true);
  });
});

describe("parseDocument run() — input validation", () => {
  it("rejects an unknown kind with a 400", async () => {
    await expect(run({ doc: { kind: "pdf" } }, ctx)).rejects.toMatchObject({ status: 400 });
    expect(llmChat).not.toHaveBeenCalled();
  });

  it("rejects a missing doc with a 400", async () => {
    await expect(run({}, ctx)).rejects.toMatchObject({ status: 400 });
    expect(llmChat).not.toHaveBeenCalled();
  });
});

describe("createParseDocumentStep", () => {
  it("requires an uploadStore", () => {
    expect(() => createParseDocumentStep({})).toThrow(/uploadStore/);
  });

  it("exposes the uniform step shape for the runner's steps map", () => {
    const { step } = createParseDocumentStep({ uploadStore: store });
    expect(step.lane).toBe("llm");
    expect(step.attemptMs).toBe(150_000);
    expect(typeof step.label).toBe("string");
    expect(typeof step.run).toBe("function");
  });
});
