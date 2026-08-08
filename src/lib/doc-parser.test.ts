import { afterEach, describe, expect, it, vi } from "vitest";
import { parseDocument } from "./doc-parser";
import { DOC_INPUT_FIXTURE } from "../fixtures/doc-image";
import { DOC_SUMMARY_FIXTURE, DOC_SUMMARY_JSON } from "../fixtures/llm";

const TEST_CONFIG = {
  baseUrl: "https://example.test/v1",
  apiKey: "sk-test",
  model: "test-model",
};

function stubFetchJson(payload: unknown, status = 200) {
  const mock = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseDocument", () => {
  it("parses a doc photo into a structured summary and sends it multimodally", async () => {
    const fetchMock = stubFetchJson({
      choices: [{ message: { content: DOC_SUMMARY_JSON } }],
    });

    const summary = await parseDocument(DOC_INPUT_FIXTURE, { config: TEST_CONFIG });

    expect(summary).toEqual(DOC_SUMMARY_FIXTURE);
    expect(summary.questions.length).toBeGreaterThanOrEqual(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/llm");
    const body = JSON.parse(String(init.body));
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.model).toBe("test-model");

    const content = body.messages[1].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
    expect(content[1]).toEqual({
      type: "image_url",
      image_url: { url: DOC_INPUT_FIXTURE.dataUrl },
    });
  });

  it("throws a typed error on invalid JSON", async () => {
    stubFetchJson({ choices: [{ message: { content: "not json" } }] });
    await expect(parseDocument(DOC_INPUT_FIXTURE, { config: TEST_CONFIG })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("throws a typed error when the summary shape is wrong", async () => {
    stubFetchJson({
      choices: [{ message: { content: JSON.stringify({ documentType: "x" }) } }],
    });
    await expect(parseDocument(DOC_INPUT_FIXTURE, { config: TEST_CONFIG })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});
