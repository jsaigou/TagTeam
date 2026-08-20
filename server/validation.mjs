/**
 * Generic hand-rolled shape validators, ported from `src/lib/llm.ts`'s
 * bottom section (the browser-only chat client above it does not port —
 * server steps call `providers.mjs#llmChat` directly). Keep in sync with the
 * client copy; this is data-shape logic, not client networking.
 */

export function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isString(value) {
  return typeof value === "string";
}

export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export function isArrayOf(check) {
  return (value) => Array.isArray(value) && value.every(check);
}

export function isOptional(check) {
  return (value) => value === undefined || check(value);
}

export function isOneOf(values) {
  const allowed = new Set(values);
  return (value) => typeof value === "string" && allowed.has(value);
}

/** Validate an object against per-field predicates; all `required` keys must be present. */
export function validateShape(value, checks, required) {
  if (!isRecord(value)) return false;
  for (const key of required) {
    const field = value[key];
    if (field === undefined || field === null) return false;
  }
  for (const key of Object.keys(checks)) {
    const check = checks[key];
    if (check === undefined) continue;
    const field = value[key];
    if (field === undefined) continue;
    if (!check(field)) return false;
  }
  return true;
}
