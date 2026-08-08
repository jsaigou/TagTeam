import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LlmError,
  buildImageUserContent,
  chat,
  chatJson,
  isGroundingQuestion,
  isLlmError,
  isTurn,
  parseChatPayload,
  resolveLlmConfig,
} from "./llm";
import { DOC_INPUT_FIXTURE } from "../fixtures/doc-image";

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
  vi.useRealTimers();
});

describe("resolveLlmConfig", () => {
  it("falls back to documented defaults when env is empty", () => {
    const cfg = resolveLlmConfig({}, {});
    expect(cfg.baseUrl).toBe("https://api.openai.com/v1");
    expect(cfg.model).toBe("gpt-4o-mini");
    expect(cfg.apiKey).toBe("");
  });

  it("reads VITE_ vars from the env and trims trailing slashes", () => {
    const cfg = resolveLlmConfig({}, {
      VITE_LLM_BASE_URL: "https://ollama.local/v1/",
      VITE_LLM_API_KEY: "abc",
      VITE_LLM_MODEL: "llama3",
    });
    expect(cfg.baseUrl).toBe("https://ollama.local/v1");
    expect(cfg.apiKey).toBe("abc");
    expect(cfg.model).toBe("llama3");
  });

  it("lets per-call overrides win over env", () => {
    const cfg = resolveLlmConfig(
      { model: "override-model" },
      { VITE_LLM_MODEL: "env-model" },
    );
    expect(cfg.model).toBe("override-model");
  });

  it("falls back to the default baseUrl when empty or whitespace", () => {
    expect(resolveLlmConfig({ baseUrl: "" }, {}).baseUrl).toBe("https://api.openai.com/v1");
    expect(resolveLlmConfig({ baseUrl: "   " }, {}).baseUrl).toBe("https://api.openai.com/v1");
    expect(resolveLlmConfig({}, { VITE_LLM_BASE_URL: "" }).baseUrl).toBe("https://api.openai.com/v1");
  });

  it("falls back to the default model when empty or whitespace", () => {
    expect(resolveLlmConfig({ model: "" }, {}).model).toBe("gpt-4o-mini");
    expect(resolveLlmConfig({}, { VITE_LLM_MODEL: "  " }).model).toBe("gpt-4o-mini");
  });
});

describe("chat", () => {
  it("posts the expected request and parses the assistant content", async () => {
    const fetchMock = stubFetchJson({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
    });

    const result = await chat(
      [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      {
        config: TEST_CONFIG,
        responseFormat: "json_object",
        temperature: 0,
      },
    );

    expect(result.content).toBe('{"ok":true}');
    expect(result.finishReason).toBe("stop");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("test-model");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.temperature).toBe(0);
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer sk-test",
    });
  });

  it("does not send an Authorization header when no key is configured", async () => {
    const fetchMock = stubFetchJson({ choices: [{ message: { content: "ok" } }] });
    await chat([{ role: "user", content: "hi" }], {
      config: { baseUrl: TEST_CONFIG.baseUrl, model: TEST_CONFIG.model },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("Authorization");
  });

  it("throws a typed auth error on 401", async () => {
    stubFetchJson({ error: { message: "invalid api key" } }, 401);
    const err = await chat([{ role: "user", content: "x" }], { config: TEST_CONFIG }).catch(
      (e: unknown) => e,
    );
    expect(isLlmError(err)).toBe(true);
    expect((err as LlmError).kind).toBe("auth");
    expect((err as LlmError).status).toBe(401);
  });

  it("throws a typed http error on other non-ok statuses", async () => {
    stubFetchJson({ error: { message: "server error" } }, 500);
    await expect(chat([{ role: "user", content: "x" }], { config: TEST_CONFIG })).rejects.toMatchObject({
      kind: "http",
      status: 500,
    });
  });

  it("throws a typed network error when fetch rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(chat([{ role: "user", content: "x" }], { config: TEST_CONFIG })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("throws a typed timeout error when the request does not complete", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      ),
    );

    const promise = chat([{ role: "user", content: "x" }], {
      config: TEST_CONFIG,
      timeoutMs: 100,
    });
    const assertion = expect(promise).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
  });

  it("throws invalid_response on a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 200 })));
    await expect(chat([{ role: "user", content: "x" }], { config: TEST_CONFIG })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });
});

describe("parseChatPayload", () => {
  it("extracts choices[0].message.content", () => {
    expect(parseChatPayload({ choices: [{ message: { content: "hi" } }] })).toEqual({
      content: "hi",
      finishReason: null,
    });
  });

  it("joins text parts from a mixed text+image_url content array", () => {
    const result = parseChatPayload({
      choices: [
        {
          message: {
            content: [
              { type: "text", text: "ご回答" },
              { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
              { type: "text", text: "ありがとうございます" },
            ],
          },
        },
      ],
    });
    expect(result.content).toBe("ご回答ありがとうございます");
  });

  it("rejects payloads without choices", () => {
    expect(() => parseChatPayload({})).toThrow(LlmError);
  });
});

describe("isTurn", () => {
  it("accepts a valid turn and rejects a wrong-typed motion field", () => {
    expect(
      isTurn({ id: "t1", speaker: "bureaucrat", jp: "A", vocab: [], motion: "[MOTION id:1]" }),
    ).toBe(true);
    expect(isTurn({ id: "t1", speaker: "bureaucrat", jp: "A", vocab: [], motion: 42 })).toBe(false);
    expect(isTurn({ id: "t1", speaker: "bureaucrat", jp: "A", vocab: [], motion: ["bad"] })).toBe(false);
  });
});

describe("chatJson", () => {
  it("parses fenced JSON and validates the shape", async () => {
    stubFetchJson({
      choices: [{ message: { content: '```json\n{"id":"q1","question":"Why?"}\n```' } }],
    });
    const question = await chatJson(
      [{ role: "user", content: "go" }],
      isGroundingQuestion,
      "GroundingQuestion",
      { config: TEST_CONFIG },
    );
    expect(question).toEqual({ id: "q1", question: "Why?" });
  });

  it("throws invalid_response when JSON does not match the shape", async () => {
    stubFetchJson({ choices: [{ message: { content: '{"id":"q1"}' } }] });
    await expect(
      chatJson([{ role: "user", content: "go" }], isGroundingQuestion, "GroundingQuestion", {
        config: TEST_CONFIG,
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("throws invalid_response on unparseable JSON", async () => {
    stubFetchJson({ choices: [{ message: { content: "not json at all" } }] });
    await expect(
      chatJson([{ role: "user", content: "go" }], isGroundingQuestion, "GroundingQuestion", {
        config: TEST_CONFIG,
      }),
    ).rejects.toMatchObject({ kind: "invalid_response" });
  });
});

describe("buildImageUserContent", () => {
  it("builds a multimodal content array with the base64 data URL", () => {
    const parts = buildImageUserContent("parse this", DOC_INPUT_FIXTURE);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "parse this" });
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: DOC_INPUT_FIXTURE.dataUrl },
    });
  });
});
