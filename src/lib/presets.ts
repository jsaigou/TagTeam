import type { CatalogItem } from "./api";
import type { RoleId } from "../shared/contract";
import { CALL_ROLES } from "./coaching";

/** The guide avatar — Luna, your practice-call assistant. */
export const DEFAULT_AVATAR_ID = "01KD2H4NWSZP4Y3CK8P3PSHTYP"; // cc051_meeks
/** The avatar used for the PRACTICE call (the default in the scenario picker). */
export const PRACTICE_AVATAR_ID = "01KH0D8ZAZHZ762FV5SK3503ZR"; // cc066_male_waiter
/** Default scene while guiding through setup — an anime backdrop. */
export const DEFAULT_SCENE_ID = "01K4NYB6627539QRJR2HXESJJK"; // sova_anime_1
/** Default scene for the PRACTICE call — a different anime backdrop. */
export const PRACTICE_SCENE_ID = "01K4NYBH42K727CZYGH6DC7Z2C"; // sova_anime_2
/** Default voice for the cute guide avatar — English-capable (guide speaks English). */
export const DEFAULT_VOICE_ID = "01KTBJGRFKWS029KQKQBC3318V"; // Female - cute and fast (For English)

/** The curated PRACTICE avatar ids — one per role (from the role packs), so the
 *  scenario step never offers more than three avatars. The user picks a role;
 *  avatar/scene/voice follow the role's pack. */
export const PRACTICE_ROLE_AVATAR_IDS: Record<RoleId, string> = {
  reception: CALL_ROLES.reception.pack?.avatarId ?? PRACTICE_AVATAR_ID,
  claims: CALL_ROLES.claims.pack?.avatarId ?? PRACTICE_AVATAR_ID,
  account: CALL_ROLES.account.pack?.avatarId ?? PRACTICE_AVATAR_ID,
};

function pick<T extends { id: string }>(items: T[], preferredId: string): T | undefined {
  return items.find((item) => item.id === preferredId) ?? items[0];
}

/** Resolve the guide avatar + default scene/voice against the loaded catalog,
 *  preferring the curated defaults and falling back to the first available. */
export function resolveDefaults(
  avatars: CatalogItem[],
  scenes: CatalogItem[],
  voices: CatalogItem[],
): { avatarId: string; sceneId: string; voiceId: string } | null {
  const avatar = pick(avatars, DEFAULT_AVATAR_ID);
  const scene = pick(scenes, DEFAULT_SCENE_ID);
  const voice = pick(voices, DEFAULT_VOICE_ID);
  if (!avatar || !scene || !voice) return null;
  return { avatarId: avatar.id, sceneId: scene.id, voiceId: voice.id };
}

export type RoleSelection = { avatarId: string; sceneId: string; voiceId: string };

/** Resolve a stored/chosen role back to its curated avatar/scene/voice
 *  selection (moved here from SetupScreen so the prep screen can relaunch the
 *  practice avatar at the ready-click too). Null when the role pack lacks a
 *  usable avatar+scene. */
export function packToSelection(role: RoleId): RoleSelection | null {
  const pack = CALL_ROLES[role].pack;
  if (!pack?.avatarId || !pack.sceneId) return null;
  return { avatarId: pack.avatarId, sceneId: pack.sceneId, voiceId: pack.voiceId ?? DEFAULT_VOICE_ID };
}

/** Prefer `preferred` when present in `items`, else `secondary`, else the first item. */
function pickWithFallback<T extends { id: string }>(
  items: T[],
  preferred?: string,
  secondary?: string,
): T | undefined {
  if (preferred) {
    const p = items.find((item) => item.id === preferred);
    if (p) return p;
  }
  if (secondary) {
    const s = items.find((item) => item.id === secondary);
    if (s) return s;
  }
  return items[0];
}

/**
 * Resolve a role's curated avatar/scene/voice against the loaded catalog,
 * falling back to the curated defaults (or the first available item) when a
 * pack id is missing. The scene is always context-driven (the role's pack) —
 * never user-selectable.
 */
export function resolveRoleSelection(
  role: RoleId,
  avatars: CatalogItem[],
  scenes: CatalogItem[],
  voices: CatalogItem[],
  fallback: RoleSelection,
): RoleSelection {
  const pack = CALL_ROLES[role].pack ?? {};
  const avatar = pickWithFallback(avatars, pack.avatarId, fallback.avatarId);
  const scene = pickWithFallback(scenes, pack.sceneId, fallback.sceneId);
  const voice = pickWithFallback(voices, pack.voiceId, fallback.voiceId);
  if (!avatar || !scene || !voice) return fallback;
  return { avatarId: avatar.id, sceneId: scene.id, voiceId: voice.id };
}
