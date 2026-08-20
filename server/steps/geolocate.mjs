/**
 * Phase 7b job step — turn `identifyTarget`'s name/city into a search-ready
 * locality hint. No geocoding provider is configured in this project (see
 * server/providers.mjs) — this is deterministic string composition, not an
 * external call. It's still a graph node (not inline logic) so `research`
 * can express a real dependency on it and a future real geocoder is a
 * same-shape swap, not a graph change.
 */

/** @param {{ name?: string, city?: string }} input */
export async function run({ name, city }) {
  const trimmedCity = typeof city === "string" ? city.trim() : "";
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const queryHint = [trimmedName, trimmedCity].filter(Boolean).join(" ");
  return { locality: trimmedCity || null, queryHint: queryHint || null };
}

export const step = {
  lane: "default",
  attemptMs: 5_000,
  label: "Locating the office…",
  run,
};
