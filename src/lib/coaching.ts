/**
 * Phase 4 — coaching layer (roles / difficulty / pace).
 *
 * Typed accessor over `src/shared/coaching.json`, the single source of truth
 * for the persona data shared with the server's nextTurn brain
 * (`server/coaching.mjs`). `buildCoachingGuidance()` composes the Japanese
 * prompt directives injected into BOTH script generation and the live brain so
 * the two never drift.
 */
import coachingData from "../shared/coaching.json";
import type { CallDifficulty, CallPace, CallSettings, RoleId } from "../shared/contract";

export type CoachingRole = {
  id: RoleId;
  label: string;
  description: string;
  /** Preferred practice avatar for this role (fall back if absent). */
  avatarId?: string;
  /** Japanese persona directive for the bureaucrat prompt. */
  persona: string;
};

export type CoachingOption = {
  id: string;
  label: string;
  guidance: string;
};

export type CoachingData = {
  roles: Record<RoleId, CoachingRole>;
  difficulty: Record<CallDifficulty, CoachingOption>;
  pace: Record<CallPace, CoachingOption>;
};

export const COACHING = coachingData as unknown as CoachingData;

export const CALL_ROLES = COACHING.roles;
export const DIFFICULTIES = COACHING.difficulty;
export const PACES = COACHING.pace;

export const ROLE_IDS = Object.keys(COACHING.roles) as RoleId[];
export const DIFFICULTY_IDS = Object.keys(COACHING.difficulty) as CallDifficulty[];
export const PACE_IDS = Object.keys(COACHING.pace) as CallPace[];

export const DEFAULT_CALL_SETTINGS: CallSettings = {
  role: "reception",
  difficulty: "beginner",
  pace: "slow",
};

/**
 * Compose the Japanese persona + difficulty + pace directives for one
 * bureaucrat prompt. Mirrored by `server/coaching.mjs` — keep in sync.
 */
export function buildCoachingGuidance(settings: CallSettings): string {
  const role = CALL_ROLES[settings.role];
  const difficulty = DIFFICULTIES[settings.difficulty];
  const pace = PACES[settings.pace];
  return [`【役割】${role.persona}`, difficulty.guidance, pace.guidance].join("\n");
}

export function isCallSettings(value: unknown): value is CallSettings {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.role === "string" &&
    ROLE_IDS.includes(v.role as RoleId) &&
    typeof v.difficulty === "string" &&
    DIFFICULTY_IDS.includes(v.difficulty as CallDifficulty) &&
    typeof v.pace === "string" &&
    PACE_IDS.includes(v.pace as CallPace)
  );
}
