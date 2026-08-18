/**
 * Phase 5c — scenario persistence (Drizzle + SQLite).
 *
 * Scenario rows hold the full call state (grounding, coaching settings,
 * selection, script, glossary, cheat sheet) as JSON blobs so a user can return
 * to a past call. All access is scoped by userId. Only JSON-safe fields are
 * stored — never the ephemeral upload ids or Connect tokens.
 */
import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "./db.mjs";

const TEXT_FIELDS = new Set(["summary", "reference"]);
const JSON_FIELDS = new Set([
  "docSummary", "target", "answers", "settings", "selection",
  "script", "glossary", "cheatSheet",
]);

function str(value) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function jsonOrNull(text) {
  if (typeof text !== "string" || !text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Lightweight list rows (metadata only — no large blobs). */
export async function listScenarios(userId) {
  const rows = await db
    .select()
    .from(schema.scenario)
    .where(eq(schema.scenario.userId, userId))
    .orderBy(desc(schema.scenario.createdAt))
    .limit(20);
  return rows.map((row) => {
    const script = jsonOrNull(row.script);
    const settings = jsonOrNull(row.settings);
    return {
      id: row.id,
      title: script?.scenarioTitle ?? "Untitled call",
      role: settings?.role ?? null,
      difficulty: settings?.difficulty ?? null,
      pace: settings?.pace ?? null,
      summary: row.summary ?? null,
      hasCheatSheet: jsonOrNull(row.cheatSheet) !== null,
      createdAt: row.createdAt,
    };
  });
}

/** Full scenario for restore, or null when the user does not own it. */
export async function getScenario(userId, id) {
  const [row] = await db
    .select()
    .from(schema.scenario)
    .where(and(eq(schema.scenario.id, id), eq(schema.scenario.userId, userId)))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    docSummary: jsonOrNull(row.docSummary),
    summary: row.summary,
    reference: row.reference,
    target: jsonOrNull(row.target),
    answers: jsonOrNull(row.answers) ?? [],
    settings: jsonOrNull(row.settings),
    selection: jsonOrNull(row.selection),
    script: jsonOrNull(row.script),
    glossary: jsonOrNull(row.glossary) ?? [],
    cheatSheet: jsonOrNull(row.cheatSheet),
    createdAt: row.createdAt,
  };
}

/** Create a scenario row from a call-start payload. */
export async function createScenario(userId, data) {
  const row = {
    id: crypto.randomUUID(),
    userId,
    sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
    docSummary: str(data.docSummary),
    summary: data.summary ?? null,
    reference: data.reference ?? null,
    target: str(data.target),
    answers: str(data.answers),
    settings: str(data.settings),
    selection: str(data.selection),
    script: str(data.script),
    glossary: str(data.glossary),
    cheatSheet: str(data.cheatSheet),
    createdAt: new Date(),
  };
  const [inserted] = await db.insert(schema.scenario).values(row).returning();
  return { id: inserted.id };
}

/** Patch an owned scenario (e.g. attach the cheat sheet after the call). */
export async function updateScenario(userId, id, patch) {
  const set = {};
  for (const [key, value] of Object.entries(patch)) {
    if (TEXT_FIELDS.has(key)) {
      set[key] = value ?? null;
    } else if (JSON_FIELDS.has(key)) {
      set[key] = str(value);
    }
  }
  if (Object.keys(set).length === 0) return null;
  const [updated] = await db
    .update(schema.scenario)
    .set(set)
    .where(and(eq(schema.scenario.id, id), eq(schema.scenario.userId, userId)))
    .returning({ id: schema.scenario.id });
  return updated ? { id: updated.id } : null;
}

/** Remove an owned scenario. Returns true when a row was deleted. */
export async function deleteScenario(userId, id) {
  const result = await db
    .delete(schema.scenario)
    .where(and(eq(schema.scenario.id, id), eq(schema.scenario.userId, userId)))
    .returning({ id: schema.scenario.id });
  return result.length > 0;
}
