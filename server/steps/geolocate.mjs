/**
 * Phase 7b job step — turn `identifyTarget`'s name/city into a search-ready
 * locality hint. No geocoding provider is configured in this project (see
 * server/providers.mjs) — this is deterministic string composition, not an
 * external call. It's still a graph node (not inline logic) so `research`
 * can express a real dependency on it and a future real geocoder is a
 * same-shape swap, not a graph change.
 */

/** @param {{ name?: string, city?: string, query?: string }} input —
 *  `query` is identifyTarget's LLM-crafted Japanese web-search query.
 *  It is preferred over the raw identified name: a romanized/English name
 *  ("mejirodai dental clinic") searches poorly on ja-JP SearXNG and used to
 *  bury the official 目白台歯科 under booking aggregators. */
export async function run({ name, city, query }) {
  const trimmedCity = typeof city === "string" ? city.trim() : "";
  const trimmedName = typeof name === "string" ? name.trim() : "";
  const trimmedQuery = typeof query === "string" ? query.trim() : "";
  const searchName = trimmedQuery || trimmedName;
  // Don't append the city when the crafted query already includes it
  // ("目白台デンタルクリニック 文京区" + "文京区" would just duplicate the term).
  const citySuffix =
    trimmedCity && !searchName.includes(trimmedCity) ? ` ${trimmedCity}` : "";
  const queryHint = `${searchName}${citySuffix}`;
  return { locality: trimmedCity || null, queryHint: queryHint || null };
}

export const step = {
  lane: "default",
  attemptMs: 5_000,
  label: "Locating the office…",
  run,
};
