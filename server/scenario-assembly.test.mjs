/**
 * server/scenario-assembly.mjs — Sprint 1's template-based "classify, then
 * fill" fast path: assembling a full script + glossary from prebuilt
 * module/vocab-pack content, no LLM call. Covers the concrete acceptance
 * test from the plan (a posted hours rule surfaces proactively in the
 * assembled script) and the fallback contract planScenario.mjs relies on
 * (hasAssemblyContent gates whether the fast path applies at all).
 */
import { describe, expect, it } from "vitest";
import { assembleScript, hasAssemblyContent } from "./scenario-assembly.mjs";

const TARGET = {
  name: "目白台デンタルクリニック",
  address: "東京都文京区目白台1-2-3",
  rules: [],
};

describe("hasAssemblyContent", () => {
  it("is true for every appt leaf with real content", () => {
    for (const leafId of [
      "appt.doctor_dentist",
      "appt.restaurant",
      "appt.salon_laser",
      "appt.cancel_reschedule",
    ]) {
      expect(hasAssemblyContent(leafId)).toBe(true);
    }
  });

  it("is false for a leaf outside the Sprint 1 pilot — planScenario must fall back to the LLM", () => {
    expect(hasAssemblyContent("medical.symptom_common")).toBe(false);
    expect(hasAssemblyContent("banking.lost_card")).toBe(false);
    expect(hasAssemblyContent("not.a.real.leaf")).toBe(false);
  });
});

describe("assembleScript", () => {
  it("throws for a leaf with no content — callers must check hasAssemblyContent first", () => {
    expect(() => assembleScript("medical.symptom_common", { target: TARGET })).toThrow();
  });

  it("produces a schema-valid, alternating script opening and closing on the bureaucrat", () => {
    const { script, glossary } = assembleScript("appt.doctor_dentist", { target: TARGET });
    expect(script.turns.length).toBeGreaterThanOrEqual(6);
    expect(script.turns.length).toBeLessThanOrEqual(10);
    expect(script.turns[0].speaker).toBe("bureaucrat");
    expect(script.turns.at(-1)?.speaker).toBe("bureaucrat");
    for (let i = 1; i < script.turns.length; i++) {
      expect(script.turns[i].speaker).not.toBe(script.turns[i - 1].speaker);
    }
    expect(glossary.length).toBe(10);
    expect(script.turns[0].jp).toContain("目白台デンタルクリニック");
  });

  it("carries a leaf-appropriate opening line (doctor/dentist vs restaurant differ)", () => {
    const dental = assembleScript("appt.doctor_dentist", { target: TARGET });
    const restaurant = assembleScript("appt.restaurant", { target: TARGET });
    expect(dental.script.turns[1].jp).toContain("予約を取りたい");
    expect(restaurant.script.turns[1].jp).toContain("予約をお願いしたい");
  });

  it("surfaces a posted hours rule proactively — the acceptance test from the plan", () => {
    const target = {
      ...TARGET,
      rules: [{ id: "r1", kind: "hours", rule: "日曜日は休診となっております", source: "https://a.example" }],
    };
    const { script } = assembleScript("appt.doctor_dentist", { target });
    const schedulingTurn = script.turns.find((t) => t.jp.includes("ご希望"));
    expect(schedulingTurn?.jp).toContain("日曜日は休診となっております");
  });

  it("omits the callout entirely when there is no hours rule", () => {
    const { script } = assembleScript("appt.doctor_dentist", { target: TARGET });
    const schedulingTurn = script.turns.find((t) => t.jp.includes("ご希望"));
    expect(schedulingTurn?.jp).not.toContain("なお、");
  });

  it("falls back to a generic facility reference when no target is given", () => {
    const { script } = assembleScript("appt.doctor_dentist", {});
    expect(script.turns[0].jp).toContain("こちら");
  });

  it("uses the cancel/reschedule module (MOD 6), not the generic booking opening", () => {
    const { script } = assembleScript("appt.cancel_reschedule", { target: TARGET });
    expect(script.turns[1].jp).toContain("変更");
    expect(script.turns[2].jp).toContain("今のご予約");
  });

  it("respects the requested voice preset — formal and friendly read differently", () => {
    const formal = assembleScript("appt.doctor_dentist", { target: TARGET, preset: "formal" });
    const friendly = assembleScript("appt.doctor_dentist", { target: TARGET, preset: "friendly" });
    expect(formal.script.turns[2].jp).toContain("恐れ入りますが");
    expect(friendly.script.turns[0].jp).toContain("！");
    expect(formal.script.turns[0].jp).not.toBe(friendly.script.turns[0].jp);
  });

  it("falls back to the standard preset for an unknown voicePreset value", () => {
    const bogus = assembleScript("appt.doctor_dentist", { target: TARGET, preset: "shouting" });
    const standard = assembleScript("appt.doctor_dentist", { target: TARGET, preset: "standard" });
    expect(bogus.script.turns[0].jp).toBe(standard.script.turns[0].jp);
  });
});
