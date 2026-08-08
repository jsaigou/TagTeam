/**
 * Static background registry. Each scenario can pick a background; the default
 * is the cute one. Add new backgrounds by dropping the file into
 * `public/backgrounds/` and registering it here under a stable key.
 */
export const DEFAULT_BACKGROUND = "cute";

const BACKGROUND_URLS: Record<string, string> = {
  cute: "/backgrounds/cute.webp",
  hospital: "/backgrounds/hospital.webp",
};

export function getBackgroundUrl(key: string | null | undefined): string {
  if (key && BACKGROUND_URLS[key]) return BACKGROUND_URLS[key];
  return BACKGROUND_URLS[DEFAULT_BACKGROUND];
}
