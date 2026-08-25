/**
 * Sprint 0 (Switchboard Plan) — server-side scenario taxonomy.
 *
 * Loads `src/shared/scenario-taxonomy.json` — the SAME source of truth shared
 * with the client (`src/lib/scenario-taxonomy.ts`) — so `classifyScenario`
 * never classifies against a different list than whatever the client later
 * shows for a given leaf. Mirrors `server/coaching.mjs`'s split.
 */
import { readFileSync } from "node:fs";

const TAXONOMY_URL = new URL("../src/shared/scenario-taxonomy.json", import.meta.url);

export const SCENARIO_TAXONOMY = JSON.parse(readFileSync(TAXONOMY_URL, "utf8"));

export const LEAVES = SCENARIO_TAXONOMY.leaves;
export const DEPARTMENTS = SCENARIO_TAXONOMY.departments;
export const LEAF_IDS = Object.keys(LEAVES);

export function isLeafId(value) {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEAVES, value);
}

/** Render the taxonomy as a flat listing for a classifier prompt: one line
 *  per leaf with its label and a couple of example phrasings. */
export function taxonomyListing() {
  return LEAF_IDS.map((id) => {
    const leaf = LEAVES[id];
    const examples = leaf.examples.slice(0, 2).join(" / ");
    return `- ${id}: ${leaf.label}（例: ${examples}）`;
  }).join("\n");
}
