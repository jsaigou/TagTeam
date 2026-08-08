/**
 * Glossary module: extracts, dedupes and reconciles {@link GlossaryEntry}s so
 * the script's `turn.vocab` ids always point at real glossary entries.
 */
import type { GlossaryEntry, SimScript, Turn } from "../shared/contract";
import {
  LlmError,
  isGlossaryEntry,
  isNonEmptyString,
  isTurn,
} from "./llm";

/**
 * Extract a clean glossary from the LLM payload: drop invalid entries and
 * de-duplicate by id (first occurrence wins, order preserved).
 */
export function extractGlossary(entries: GlossaryEntry[]): GlossaryEntry[] {
  const seen = new Set<string>();
  const out: GlossaryEntry[] = [];
  for (const entry of entries) {
    if (!isGlossaryEntry(entry) || !isNonEmptyString(entry.id)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out;
}

/** Build an id -> entry lookup map. */
export function glossaryById(entries: GlossaryEntry[]): Map<string, GlossaryEntry> {
  const map = new Map<string, GlossaryEntry>();
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
export function reconcileScript(script: SimScript, glossary: GlossaryEntry[]): SimScript {
  const byId = glossaryById(glossary);

  let turns: Turn[] = script.turns.filter(isTurn);

  turns = turns.map((turn) => ({
    ...turn,
    vocab: turn.vocab.filter((id) => byId.has(id)),
  }));

  const firstBureaucrat = turns.findIndex((turn) => turn.speaker === "bureaucrat");
  if (firstBureaucrat === -1) {
    throw new LlmError("invalid_response", "Simulation script contains no bureaucrat turns");
  }
  if (firstBureaucrat > 0 && turns.length - firstBureaucrat >= 6) {
    turns = turns.slice(firstBureaucrat);
  }

  const alternated: Turn[] = [];
  for (const turn of turns) {
    const prev = alternated[alternated.length - 1];
    if (prev !== undefined && prev.speaker === turn.speaker) continue;
    alternated.push(turn);
  }
  if (alternated.length >= 6) turns = alternated;

  if (turns.length > 10) turns = turns.slice(0, 10);
  if (turns.length < 6) {
    throw new LlmError("invalid_response", `Expected 6-10 turns, got ${turns.length}`);
  }

  return { scenarioTitle: script.scenarioTitle, turns };
}

/** Full reconciliation of an LLM sim payload into a contract-compliant result. */
export function reconcileSimulation(raw: {
  script: SimScript;
  glossary: GlossaryEntry[];
}): { script: SimScript; glossary: GlossaryEntry[] } {
  const glossary = extractGlossary(raw.glossary);
  const script = reconcileScript(raw.script, glossary);
  return { script, glossary };
}
