/**
 * Thin OpenAI-compatible chat client (pure logic, no UI).
 *
 * Talks to `POST {baseUrl}/chat/completions` and supports text chat, multimodal
 * image content (base64 data URLs) and `response_format: { type: "json_object" }`
 * for structured output. Responses are validated against the coordinator-owned
 * contract shapes with the small hand-rolled validators at the bottom of this
 * file. Every failure surfaces as a typed {@link LlmError}.
 */
import type {
  CheatSheet,
  CheatSheetPhrase,
  GlossaryEntry,
  GroundingQuestion,
  ImageDoc,
  SimScript,
  Turn,
} from "../shared/contract";

export const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_TIMEOUT_MS = 60_000;

/* ------------------------------------------------------------------ config */

export type LlmConfig = {
  /** e.g. "https://api.openai.com/v1" (trailing slash trimmed). */
  baseUrl: string;
  apiKey: string;
  model: string;
};

/**
 * Resolve config from Vite env vars, overridable per call.
 * `env` is injectable for offline tests; defaults to `import.meta.env`.
 */
export function resolveLlmConfig(
  overrides?: Partial<LlmConfig>,
  env?: Record<string, string | undefined>,
): LlmConfig {
  const source = env ?? (import.meta.env as Record<string, string | undefined>);
  const rawBaseUrl = overrides?.baseUrl ?? source.VITE_LLM_BASE_URL;
  const baseUrl = (rawBaseUrl !== undefined && rawBaseUrl.trim().length > 0
    ? rawBaseUrl.trim()
    : DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const model = overrides?.model ?? source.VITE_LLM_MODEL;
  return {
    baseUrl,
    apiKey: overrides?.apiKey ?? source.VITE_LLM_API_KEY ?? "",
    model: model !== undefined && model.trim().length > 0 ? model.trim() : DEFAULT_MODEL,
  };
}

/* ----------------------------------------------------------------- errors */

export type LlmErrorKind =
  | "config"
  | "timeout"
  | "auth"
  | "http"
  | "network"
  | "invalid_response";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;

  constructor(kind: LlmErrorKind, message: string, opts: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: opts.cause });
    this.name = "LlmError";
    this.kind = kind;
    this.status = opts.status;
  }
}

export function isLlmError(value: unknown): value is LlmError {
  return value instanceof LlmError;
}

/* ----------------------------------------------------------------- message */

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
};

/** Build the multimodal user message content for a document photo. */
export function buildImageUserContent(text: string, doc: ImageDoc): ChatContentPart[] {
  return [
    { type: "text", text },
    { type: "image_url", image_url: { url: doc.dataUrl } },
  ];
}

/* -------------------------------------------------------------------- chat */

export type ChatOptions = {
  temperature?: number;
  responseFormat?: "json_object";
  timeoutMs?: number;
  config?: Partial<LlmConfig>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Test hook: override the VITE_ env source (defaults to import.meta.env). */
  env?: Record<string, string | undefined>;
};

export type ChatResult = {
  content: string;
  finishReason: string | null;
};

/**
 * POST a chat completion. Resolves with the assistant text content.
 * Throws a typed {@link LlmError} on auth failures, HTTP errors, timeouts,
 * network failures or a malformed/unparseable response body.
 */
export async function chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
  const cfg = resolveLlmConfig(options.config, options.env);
  if (!cfg.baseUrl) {
    throw new LlmError("config", "LLM base URL is not configured (VITE_LLM_BASE_URL)");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      options.signal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: options.temperature ?? 0.2,
  };
  if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const fetchImpl = options.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await fetchImpl(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new LlmError("timeout", `LLM request timed out after ${timeoutMs}ms`, { cause: err });
    }
    throw new LlmError("network", `LLM request failed: ${messageOf(err)}`, { cause: err });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onExternalAbort);
  }

  if (!res.ok) {
    const kind = res.status === 401 || res.status === 403 ? "auth" : "http";
    const detail = await safeErrorText(res);
    throw new LlmError(kind, `LLM request failed (${res.status}): ${detail}`, { status: res.status });
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    throw new LlmError("invalid_response", "LLM returned a non-JSON response body", { cause: err });
  }
  return parseChatPayload(data);
}

/** Extract `choices[0].message.content` from a raw chat completions payload. */
export function parseChatPayload(data: unknown): ChatResult {
  if (!isRecord(data)) {
    throw new LlmError("invalid_response", "LLM response is not a JSON object");
  }
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new LlmError("invalid_response", "LLM response contains no choices");
  }
  const choice = choices[0];
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new LlmError("invalid_response", "LLM response contains a malformed choice");
  }
  const content = contentToString(choice.message.content);
  if (content === null) {
    throw new LlmError("invalid_response", "LLM response is missing message.content");
  }
  return {
    content,
    finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : null,
  };
}

/* -------------------------------------------------------- structured (JSON) */

/**
 * Chat with `response_format: { type: "json_object" }`, parse the assistant
 * text as JSON (tolerating ```json fences) and validate it against `check`.
 */
export async function chatJson<T>(
  messages: ChatMessage[],
  check: (value: unknown) => value is T,
  label: string,
  options: ChatOptions = {},
): Promise<T> {
  const result = await chat(messages, { ...options, responseFormat: "json_object" });
  return parseJsonObject(result.content, check, label);
}

/** Parse + validate a JSON string. Throws LlmError("invalid_response") on failure. */
export function parseJsonObject<T>(
  content: string,
  check: (value: unknown) => value is T,
  label: string,
): T {
  let text = content.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) text = fenced[1];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new LlmError("invalid_response", `LLM returned invalid JSON for ${label}`, { cause: err });
  }
  if (!check(parsed)) {
    throw new LlmError("invalid_response", `LLM response failed ${label} validation`);
  }
  return parsed;
}

/* ------------------------------------------------------------ validators */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

export function isArrayOf<T>(check: (value: unknown) => value is T): (value: unknown) => value is T[] {
  return (value): value is T[] => Array.isArray(value) && value.every(check);
}

export function isOptional<T>(check: (value: unknown) => value is T): (value: unknown) => value is T | undefined {
  return (value): value is T | undefined => value === undefined || check(value);
}

export function isOneOf<T extends string>(values: readonly T[]): (value: unknown) => value is T {
  const allowed = new Set<string>(values);
  return (value): value is T => typeof value === "string" && allowed.has(value);
}

type FieldChecks<T> = { [K in keyof T]?: (value: unknown) => boolean };

/** Validate an object against per-field predicates; all `required` keys must be present. */
export function validateShape<T extends object>(
  value: unknown,
  checks: FieldChecks<T>,
  required: readonly (keyof T)[],
): value is T {
  if (!isRecord(value)) return false;
  for (const key of required) {
    const field = value[key as string];
    if (field === undefined || field === null) return false;
  }
  for (const key of Object.keys(checks) as (keyof T)[]) {
    const check = checks[key];
    if (check === undefined) continue;
    const field = value[key as string];
    if (field === undefined) continue;
    if (!check(field)) return false;
  }
  return true;
}

export const isGroundingQuestion = (value: unknown): value is GroundingQuestion =>
  validateShape<GroundingQuestion>(
    value,
    {
      id: isNonEmptyString,
      question: isNonEmptyString,
      options: isOptional(isStringArray),
    },
    ["id", "question"],
  );

export const isGroundingQuestionArray = isArrayOf(isGroundingQuestion);

export const isTurn = (value: unknown): value is Turn =>
  validateShape<Turn>(
    value,
    {
      id: isNonEmptyString,
      speaker: isOneOf(["bureaucrat", "user"] as const),
      jp: isNonEmptyString,
      en: isOptional(isString),
      vocab: isStringArray,
      motion: isOptional(isString),
    },
    ["id", "speaker", "jp", "vocab"],
  );

export const isTurnArray = isArrayOf(isTurn);

export const isGlossaryEntry = (value: unknown): value is GlossaryEntry =>
  validateShape<GlossaryEntry>(
    value,
    {
      id: isNonEmptyString,
      kanji: isNonEmptyString,
      furigana: isNonEmptyString,
      en: isNonEmptyString,
      note: isOptional(isString),
    },
    ["id", "kanji", "furigana", "en"],
  );

export const isGlossaryEntryArray = isArrayOf(isGlossaryEntry);

export const isSimScript = (value: unknown): value is SimScript =>
  validateShape<SimScript>(value, { scenarioTitle: isNonEmptyString, turns: isTurnArray }, [
    "scenarioTitle",
    "turns",
  ]);

export type SimulationRaw = { scenarioTitle: string; turns: Turn[]; glossary: GlossaryEntry[] };

/** Shape of the flat script + glossary JSON object the sim prompt returns. */
export const isSimulationRaw = (value: unknown): value is SimulationRaw => {
  if (!isRecord(value)) return false;
  return isSimScript({ scenarioTitle: value.scenarioTitle, turns: value.turns }) &&
    isGlossaryEntryArray(value.glossary);
};

export const isCheatSheetPhrase = (value: unknown): value is CheatSheetPhrase =>
  validateShape<CheatSheetPhrase>(
    value,
    {
      jp: isNonEmptyString,
      furigana: isNonEmptyString,
      en: isNonEmptyString,
      when: isNonEmptyString,
    },
    ["jp", "furigana", "en", "when"],
  );

export const isCheatSheet = (value: unknown): value is CheatSheet =>
  validateShape<CheatSheet>(
    value,
    {
      goal: isNonEmptyString,
      keyPhrases: isArrayOf(isCheatSheetPhrase),
      practice: isStringArray,
    },
    ["goal", "keyPhrases", "practice"],
  );

/* ------------------------------------------------------------ internals */

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function contentToString(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts = content
      .filter((part): part is { text: string } => isRecord(part) && typeof part.text === "string")
      .map((part) => part.text);
    return parts.length > 0 ? parts.join("") : null;
  }
  return null;
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (isRecord(data) && isRecord(data.error) && typeof data.error.message === "string") {
      return data.error.message;
    }
    return JSON.stringify(data).slice(0, 200);
  } catch {
    return `HTTP ${res.status}`;
  }
}
