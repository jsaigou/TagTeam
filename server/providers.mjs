/**
 * Provider layer — every external capability is env-driven, so a homelab
 * (LLM, SearXNG, Firecrawl) is reusable AND a bare install works. Phase 3 adds
 * the STT + Connect Chatbot providers behind the same pattern.
 */

export const config = {
  llm: {
    provider: (process.env.LLM_PROVIDER || "openai").toLowerCase(), // openai | anthropic
    baseUrl: (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    apiKey: process.env.LLM_API_KEY || "",
    model: process.env.LLM_MODEL || "gpt-4o-mini",
  },
  search: {
    searxngUrl: (process.env.SEARXNG_URL || "").replace(/\/+$/, ""),
    // Geo-scoping: biases results to Japan so a bare office name doesn't
    // surface wrong-country businesses (see docs/phase0-spike.md).
    language: process.env.SEARCH_LANGUAGE || "ja-JP",
  },
  scrape: {
    firecrawlUrl: (process.env.FIRECRAWL_URL || "").replace(/\/+$/, ""),
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY || "",
  },
};

function openAiCompatibleResponse(payload) {
  if (config.llm.provider !== "anthropic") return payload;
  const text = payload.content
    ?.find?.((part) => part.type === "text")
    ?.text;
  return {
    choices: [{ message: { role: "assistant", content: text ?? "" } }],
  };
}

/**
 * OpenAI-compatible chat completion against the configured provider. Returns a
 * payload shaped like the OpenAI Chat Completions response.
 */
export async function llmChat(
  messages,
  { model, temperature = 0.2, responseFormat, maxTokens = 8192 } = {},
) {
  if (!config.llm.apiKey) {
    throw Object.assign(new Error("LLM is not configured. Set LLM_API_KEY (and LLM_BASE_URL / LLM_MODEL) in .env — see SETUP.md."), { status: 501 });
  }

  let url;
  let headers = { "Content-Type": "application/json" };
  let body;

  if (config.llm.provider === "anthropic") {
    url = `${config.llm.baseUrl}/messages`;
    headers["x-api-key"] = config.llm.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    body = {
      model: model || config.llm.model,
      max_tokens: maxTokens,
      messages: messages.filter((m) => m.role !== "system"),
      ...(system ? { system } : {}),
    };
    if (responseFormat) {
      body.output_config = { format: { type: "json_schema", schema: responseFormat.json_schema?.schema ?? responseFormat } };
    }
  } else {
    url = `${config.llm.baseUrl}/chat/completions`;
    headers.Authorization = `Bearer ${config.llm.apiKey}`;
    body = {
      model: model || config.llm.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (responseFormat) body.response_format = responseFormat;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw Object.assign(new Error(`LLM request failed (${res.status})`), {
      status: 502,
      payload: { error: (detail || "LLM upstream error").slice(0, 500) },
    });
  }
  const payload = await res.json();
  return openAiCompatibleResponse(payload);
}
