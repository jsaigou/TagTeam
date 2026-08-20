/**
 * Simulation-script validation + reconciliation, ported from `src/lib/llm.ts`
 * (isTurn/isGlossaryEntry/isSimScript/isSimulationRaw) and `src/lib/glossary.ts`
 * (extractGlossary/glossaryById/reconcileScript/reconcileSimulation) for the
 * server-side `planScenario` job step (Phase 7 plan §7b.5 migration step 4).
 * Ported rather than re-derived — keep in sync with the client copies (used
 * by `src/lib/cheat-sheet.ts` etc.) if either changes.
 */
import { isArrayOf, isNonEmptyString, isOneOf, isOptional, isString, validateShape } from "./validation.mjs";

const TURN_EMOTIONS = [
  "joy", "excitement", "admiration", "caring", "gratitude", "sadness",
  "disappointment", "annoyance", "embarrassment", "curiosity", "surprise",
  "realization", "confusion",
];

export const isTurn = (value) =>
  validateShape(
    value,
    {
      id: isNonEmptyString,
      speaker: isOneOf(["bureaucrat", "user"]),
      jp: isNonEmptyString,
      en: isOptional(isString),
      vocab: isArrayOf(isString),
      motion: isOptional(isString),
      emotion: isOptional(isOneOf(TURN_EMOTIONS)),
      intensity: isOptional(isOneOf(["low", "neutral", "high"])),
    },
    ["id", "speaker", "jp", "vocab"],
  );

export const isTurnArray = isArrayOf(isTurn);

export const isGlossaryEntry = (value) =>
  validateShape(
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

export const isSimScript = (value) =>
  validateShape(value, { scenarioTitle: isNonEmptyString, turns: isTurnArray }, [
    "scenarioTitle",
    "turns",
  ]);

/** Shape of the flat script + glossary JSON object the sim prompt returns. */
export const isSimulationRaw = (value) => {
  if (typeof value !== "object" || value === null) return false;
  return (
    isSimScript({ scenarioTitle: value.scenarioTitle, turns: value.turns }) &&
    isGlossaryEntryArray(value.glossary)
  );
};

/** Thrown by `reconcileScript` when the model's script can't be reconciled
 *  into a contract-compliant shape — mirrors `LlmError("invalid_response", …)`
 *  from `src/lib/llm.ts` (a plain Error here; server steps use `.status` for
 *  HTTP mapping, not `.kind`, per `identifyTarget.mjs`/`extractTargetRules.mjs`). */
function invalidResponse(message) {
  return Object.assign(new Error(message), { status: 502, kind: "invalid_response" });
}

/**
 * Extract a clean glossary from the LLM payload: drop invalid entries and
 * de-duplicate by id (first occurrence wins, order preserved).
 */
export function extractGlossary(entries) {
  const seen = new Set();
  const out = [];
  for (const entry of entries) {
    if (!isGlossaryEntry(entry) || !isNonEmptyString(entry.id)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** Build an id -> entry lookup map. */
export function glossaryById(entries) {
  const map = new Map();
  for (const entry of entries) map.set(entry.id, entry);
  return map;
}

/**
 * Reconcile a raw script so it satisfies the simulation contract:
 * - drops unknown vocab ids (only ids present in the glossary survive),
 * - trims leading user turns so the call opens with the bureaucrat,
 * - enforces bureaucrat/user alternation ("back-and-forth"),
 * - clamps to 6-10 turns, throwing if fewer than 6 remain.
 */
export function reconcileScript(script, glossary) {
  const byId = glossaryById(glossary);

  let turns = script.turns.filter(isTurn);

  turns = turns.map((turn) => ({
    ...turn,
    vocab: turn.vocab.filter((id) => byId.has(id)),
  }));

  const firstBureaucrat = turns.findIndex((turn) => turn.speaker === "bureaucrat");
  if (firstBureaucrat === -1) {
    throw invalidResponse("Simulation script contains no bureaucrat turns");
  }
  turns = turns.slice(firstBureaucrat);

  const alternated = [];
  for (const turn of turns) {
    const prev = alternated[alternated.length - 1];
    if (prev !== undefined && prev.speaker === turn.speaker) continue;
    alternated.push(turn);
  }
  if (alternated.length >= 6) turns = alternated;

  if (turns.length > 10) turns = turns.slice(0, 10);
  if (turns.length < 6) {
    throw invalidResponse(`Expected 6-10 turns, got ${turns.length}`);
  }

  return { scenarioTitle: script.scenarioTitle, turns };
}

/** Full reconciliation of an LLM sim payload into a contract-compliant result. */
export function reconcileSimulation(raw) {
  const glossary = extractGlossary(raw.glossary);
  const script = reconcileScript(raw.script, glossary);
  return { script, glossary };
}
