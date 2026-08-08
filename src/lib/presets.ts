import type { CatalogItem } from "./api";

/** The star avatar — always present, guides the user, plays the call role. */
export const DEFAULT_AVATAR_ID = "01KD2H4NWSZP4Y3CK8P3PSHTYP"; // cc051_meeks
/** Default scene while guiding through setup. */
export const DEFAULT_SCENE_ID = "01KQEJC9GEYHMHX707G0749NHJ"; // sova_Interior_41
/** Default voice for the cute guide avatar. */
export const DEFAULT_VOICE_ID = "01KXFXE2QJYNH7895KYT1QTAP6"; // Female - cute and kind

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
