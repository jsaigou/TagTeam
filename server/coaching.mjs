/**
 * Phase 4 — server-side coaching data (roles / difficulty / pace).
 *
 * Loads `src/shared/coaching.json` — the SINGLE source of truth shared with the
 * client (`src/lib/coaching.ts`). `buildCoachingGuidance` mirrors the client
 * composer; keep the two in sync. This is what keeps the live nextTurn brain's
 * persona identical to the generated script's persona.
 */
import { readFileSync } from "node:fs";

const COACHING_URL = new URL("../src/shared/coaching.json", import.meta.url);

const COACHING = JSON.parse(readFileSync(COACHING_URL, "utf8"));

const ROLE_IDS = ["reception", "claims", "account"];
const DIFFICULTY_IDS = ["beginner", "intermediate", "advanced"];
const PACE_IDS = ["slow", "normal", "fast"];

/** Accepts a user-supplied settings object (defensive validation). */
export function isCallSettings(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    ROLE_IDS.includes(value.role) &&
    DIFFICULTY_IDS.includes(value.difficulty) &&
    PACE_IDS.includes(value.pace)
  );
}

/**
 * Compose the Japanese role + difficulty + pace directives for the bureaucrat
 * prompt. Mirrors `src/lib/coaching.ts` — keep in sync.
 */
export function buildCoachingGuidance(settings) {
  const role = COACHING.roles[settings.role];
  const difficulty = COACHING.difficulty[settings.difficulty];
  const pace = COACHING.pace[settings.pace];
  return [`【役割】${role.persona}`, difficulty.guidance, pace.guidance].join("\n");
}
