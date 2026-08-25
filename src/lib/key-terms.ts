/**
 * Prep-screen briefing: which glossary entries become the "3 key terms".
 * Entries actually referenced by the script's turns come first (they are the
 * ones the rehearsal will really use), in glossary order; the rest pad up to
 * `max`. Pure + exported for tests.
 */
import type { GlossaryEntry, SimScript } from "@/shared/contract";

export function pickKeyTerms(
  glossary: GlossaryEntry[],
  script: SimScript | null,
  max = 3,
): GlossaryEntry[] {
  const used = new Set((script?.turns ?? []).flatMap((t) => t.vocab));
  const referenced = glossary.filter((g) => used.has(g.id));
  const rest = glossary.filter((g) => !used.has(g.id));
  return [...referenced, ...rest].slice(0, Math.max(0, max));
}
