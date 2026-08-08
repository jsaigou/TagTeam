import type { CatalogItem } from "./api";

/** The star avatar — guides the user through setup. */
export const DEFAULT_AVATAR_ID = "01KD2H4NWSZP4Y3CK8P3PSHTYP"; // cc051_meeks
/** The avatar used for the PRACTICE call (the default in the scenario picker). */
export const PRACTICE_AVATAR_ID = "01KH0D8ZAZHZ762FV5SK3503ZR"; // cc066_male_waiter
/** Default scene while guiding through setup — a clean abstract backdrop that
 *  fits the small avatar window (the static image is the real background). */
export const DEFAULT_SCENE_ID = "01K4NYAEZPZQS6D90F319GMRD2"; // sova_Abstract_5
/** Default voice for the cute guide avatar — English-capable (guide speaks English). */
export const DEFAULT_VOICE_ID = "01KTBJGRFKWS029KQKQBC3318V"; // Female - cute and fast (For English)

function pick<T extends { id: string }>(items: T[], preferredId: string): T | undefined {
  return items.find((item) => item.id === preferredId) ?? items[0];
}

/** Resolve the star avatar + default scene/voice against the loaded catalog,
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
