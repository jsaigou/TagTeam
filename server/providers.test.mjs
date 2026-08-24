/**
 * llmChat must survive transient upstream blips (429/5xx, dropped
 * connections) with bounded backoff — one 502 from the homelab proxy used to
 * surface verbatim in Luna's chat as "LLM request failed (502)". Auth errors
 * and caller aborts are never retried.
 */
import { afterEach, describe, expect, it } from "vitest";
import { config, llmChat } from "./providers.mjs";

const OK_PAYLOAD = { choices: [{ message: { role: "assistant", content: "{}" } }] };

function okResponse() {
  return { ok: true, status: 200, json: async () => OK_PAYLOAD };
}
function errResponse(status, body = "") {
  return { ok: false, status, text: async () => body };
}

describe("llmChat retry", () => {
  const savedLlm = config.llm;
  afterEach(() => {
    config.llm = savedLlm;
  });

  function useLlm() {
    config.llm = { apiKey: "test-key", baseUrl: "http://upstream.test/v1", model: "test-model", provider: "openai" };
  }

  it("retries a transient 503 and succeeds", async () => {
    useLlm();
    let calls = 0;
    const fetchImpl = async () => (++calls === 1 ? errResponse(503) : okResponse());
    const out = await llmChat([{ role: "user", content: "hi" }], { fetchImpl });
    expect(out.choices[0].message.content).toBe("{}");
    expect(calls).toBe(2);
  });

  it("retries a dropped connection and succeeds", async () => {
    useLlm();
    let calls = 0;
    const fetchImpl = async () => {
      if (++calls === 1) throw new TypeError("fetch failed");
      return okResponse();
    };
    const out = await llmChat([{ role: "user", content: "hi" }], { fetchImpl });
    expect(out.choices[0].message.content).toBe("{}");
  });

  it("gives up after the final retry on persistent upstream errors", async () => {
    useLlm();
    let calls = 0;
    const fetchImpl = async () => (++calls, errResponse(502));
    await expect(llmChat([{ role: "user", content: "hi" }], { fetchImpl })).rejects.toMatchObject({
      status: 502,
      payload: { error: "LLM upstream error" },
    });
    expect(calls).toBe(3);
  });

  it("never retries auth errors", async () => {
    useLlm();
    let calls = 0;
    const fetchImpl = async () => (++calls, errResponse(401, '{"error":"bad key"}'));
    await expect(llmChat([{ role: "user", content: "hi" }], { fetchImpl })).rejects.toMatchObject({
      status: 502,
      payload: { error: '{"error":"bad key"}' },
    });
    expect(calls).toBe(1);
  });

  it("does not retry when the caller aborts", async () => {
    useLlm();
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = async () => {
      ++calls;
      throw Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    };
    await expect(
      llmChat([{ role: "user", content: "hi" }], { fetchImpl, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});
