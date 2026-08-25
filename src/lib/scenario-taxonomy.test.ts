import { describe, expect, it } from "vitest";
import {
  DEPARTMENTS,
  DEPARTMENT_IDS,
  LEAF_IDS,
  LEAVES,
  isLeafId,
  leavesForDepartment,
} from "./scenario-taxonomy";

describe("scenario-taxonomy", () => {
  it("exposes the five departments from the plan", () => {
    expect(DEPARTMENT_IDS.sort()).toEqual(["appt", "banking", "gov", "housing", "medical"].sort());
    for (const dept of Object.values(DEPARTMENTS)) {
      expect(dept.label).toBeTruthy();
    }
  });

  it("gives every leaf a valid department, standardization and at least one example", () => {
    expect(LEAF_IDS.length).toBeGreaterThan(0);
    for (const leaf of Object.values(LEAVES)) {
      expect(DEPARTMENT_IDS).toContain(leaf.department);
      expect(["high", "medium", "low"]).toContain(leaf.standardization);
      expect(leaf.label).toBeTruthy();
      expect(leaf.examples.length).toBeGreaterThan(0);
    }
  });

  it("splits housing's named urgent-damage leaf from the unnamed fallback (post-review taxonomy fix)", () => {
    expect(LEAVES["housing.urgent_damage"].standardization).toBe("medium");
    expect(LEAVES["housing.other_damage"].standardization).toBe("low");
  });

  it("groups leaves by department", () => {
    const apptLeaves = leavesForDepartment("appt").map((l) => l.id);
    expect(apptLeaves).toContain("appt.doctor_dentist");
    expect(apptLeaves).toContain("appt.cancel_reschedule");
    expect(apptLeaves.every((id) => LEAVES[id].department === "appt")).toBe(true);
  });

  it("validates leaf ids", () => {
    expect(isLeafId("appt.doctor_dentist")).toBe(true);
    expect(isLeafId("not.a.real.leaf")).toBe(false);
    expect(isLeafId(null)).toBe(false);
    expect(isLeafId(undefined)).toBe(false);
  });
});
