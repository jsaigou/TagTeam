/**
 * Phase 5c — REST client for scenario persistence (server/scenarios.mjs).
 * Scenarios are saved at call start (call state) and updated with the cheat
 * sheet when the call finishes; the setup screen lists them for restore.
 */
import type {
  CallSettings,
  CheatSheet,
  GlossaryEntry,
  GroundingAnswer,
  SimScript,
  TargetProfile,
} from "@/shared/contract";
import type { DocSummary } from "@/lib/doc-parser";
import { jsonRequest } from "./session-api";

export type ScenarioSelection = {
  avatarId: string;
  sceneId: string;
  voiceId: string;
};

/** Full stored scenario (what `GET /api/scenarios/:id` returns). */
export type StoredScenario = {
  id: string;
  sessionId: string | null;
  docSummary: DocSummary | null;
  summary: string | null;
  reference: string | null;
  target: TargetProfile | null;
  answers: GroundingAnswer[];
  settings: CallSettings | null;
  selection: ScenarioSelection | null;
  script: SimScript | null;
  glossary: GlossaryEntry[];
  cheatSheet: CheatSheet | null;
  createdAt: string;
};

/** Lightweight list row (metadata only). */
export type ScenarioSummary = {
  id: string;
  title: string;
  role: string | null;
  difficulty: string | null;
  pace: string | null;
  summary: string | null;
  hasCheatSheet: boolean;
  createdAt: string;
};

export type SaveScenarioInput = {
  sessionId?: string;
  docSummary?: DocSummary | null;
  summary?: string | null;
  reference?: string | null;
  target?: TargetProfile | null;
  answers?: GroundingAnswer[];
  settings: CallSettings;
  selection: ScenarioSelection;
  script: SimScript;
  glossary: GlossaryEntry[];
};

/** Save a new scenario (call start). Returns its id. */
export const createScenario = (input: SaveScenarioInput) =>
  jsonRequest<{ id: string }>("/api/scenarios", {
    method: "POST",
    body: JSON.stringify(input),
  });

/** Patch an owned scenario (e.g. attach the cheat sheet). */
export const updateScenario = (id: string, patch: { cheatSheet?: CheatSheet }) =>
  jsonRequest<{ id: string }>(`/api/scenarios/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

/** List the user's saved scenarios (newest first). */
export const listScenarios = () =>
  jsonRequest<{ items: ScenarioSummary[] }>("/api/scenarios");

/** Fetch one full scenario for restore. */
export const getScenario = (id: string) =>
  jsonRequest<StoredScenario>(`/api/scenarios/${id}`);

/** Delete a saved scenario. */
export const deleteScenario = (id: string) =>
  jsonRequest<{ ok: boolean }>(`/api/scenarios/${id}`, { method: "DELETE" });
