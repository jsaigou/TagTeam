/**
 * Sprint 0 (Switchboard Plan) — typed accessor over
 * `src/shared/scenario-taxonomy.json`, the single source of truth shared with
 * the server's `classifyScenario` step (`server/scenario-taxonomy.mjs`).
 * Mirrors `src/lib/coaching.ts`'s split for the same reason: the client and
 * the server must never classify against different lists.
 */
import taxonomyData from "../shared/scenario-taxonomy.json";

export type DepartmentId = "appt" | "medical" | "banking" | "housing" | "gov";

export type Standardization = "high" | "medium" | "low";

export type ScenarioDepartment = {
  id: DepartmentId;
  label: string;
};

export type ScenarioLeaf = {
  id: string;
  department: DepartmentId;
  label: string;
  standardization: Standardization;
  /** Reference phrasings for the classifier prompt — not UI copy. */
  examples: string[];
};

export type ScenarioTaxonomy = {
  departments: Record<DepartmentId, ScenarioDepartment>;
  leaves: Record<string, ScenarioLeaf>;
};

export const SCENARIO_TAXONOMY = taxonomyData as unknown as ScenarioTaxonomy;

export const DEPARTMENTS = SCENARIO_TAXONOMY.departments;
export const LEAVES = SCENARIO_TAXONOMY.leaves;

export const DEPARTMENT_IDS = Object.keys(DEPARTMENTS) as DepartmentId[];
export const LEAF_IDS = Object.keys(LEAVES);

export function isLeafId(value: unknown): value is string {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LEAVES, value);
}

/** Leaves grouped under a department, in taxonomy order. */
export function leavesForDepartment(department: DepartmentId): ScenarioLeaf[] {
  return LEAF_IDS.map((id) => LEAVES[id]).filter((leaf) => leaf.department === department);
}
