import { describe, expect, it } from "vitest";
import {
  CALL_ROLES,
  DEFAULT_CALL_SETTINGS,
  DIFFICULTIES,
  PACES,
  ROLE_IDS,
  buildCoachingGuidance,
  isCallSettings,
} from "./coaching";

describe("coaching", () => {
  it("exposes the shared roles, difficulties and paces", () => {
    expect(ROLE_IDS).toEqual(["reception", "claims", "account"]);
    expect(Object.keys(DIFFICULTIES)).toEqual(["beginner", "intermediate", "advanced"]);
    expect(Object.keys(PACES)).toEqual(["slow", "normal", "fast"]);
    for (const role of Object.values(CALL_ROLES)) {
      expect(role.label).toBeTruthy();
      expect(role.description).toBeTruthy();
      expect(role.persona).toContain("あなたは");
    }
    for (const diff of Object.values(DIFFICULTIES)) {
      expect(diff.guidance).toContain("【難易度】");
    }
    for (const pace of Object.values(PACES)) {
      expect(pace.guidance).toContain("【ペース】");
    }
  });

  it("curates a distinct avatar/scene/voice pack per role", () => {
    const packs = Object.values(CALL_ROLES).map((role) => role.pack);
    for (const pack of packs) {
      expect(pack?.avatarId).toBeTruthy();
      expect(pack?.sceneId).toBeTruthy();
      expect(pack?.voiceId).toBeTruthy();
    }
    const avatarIds = new Set(packs.map((p) => p?.avatarId));
    const voiceIds = new Set(packs.map((p) => p?.voiceId));
    expect(avatarIds.size).toBe(3);
    expect(voiceIds.size).toBe(3);
  });

  it("builds a guidance block for the settings", () => {
    const guidance = buildCoachingGuidance(DEFAULT_CALL_SETTINGS);
    expect(guidance).toContain("【役割】");
    expect(guidance).toContain(CALL_ROLES.reception.persona);
    expect(guidance).toContain(DIFFICULTIES.beginner.guidance);
    expect(guidance).toContain(PACES.slow.guidance);
  });

  it("respects the selected role/difficulty/pace", () => {
    const guidance = buildCoachingGuidance({
      role: "claims",
      difficulty: "advanced",
      pace: "fast",
    });
    expect(guidance).toContain(CALL_ROLES.claims.persona);
    expect(guidance).toContain(DIFFICULTIES.advanced.guidance);
    expect(guidance).toContain(PACES.fast.guidance);
    expect(guidance).not.toContain(CALL_ROLES.reception.persona);
  });

  it("validates settings objects", () => {
    expect(isCallSettings(DEFAULT_CALL_SETTINGS)).toBe(true);
    expect(isCallSettings({ role: "reception", difficulty: "beginner", pace: "slow" })).toBe(true);
    expect(isCallSettings({ role: "bogus", difficulty: "beginner", pace: "slow" })).toBe(false);
    expect(isCallSettings({ role: "reception", difficulty: "easy", pace: "slow" })).toBe(false);
    expect(isCallSettings(null)).toBe(false);
    expect(isCallSettings(undefined)).toBe(false);
  });
});
