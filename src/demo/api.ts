import type { CatalogItem, MotionAsset } from "@/lib/api";

/**
 * Shared demo API — unauthenticated `/api/demo/*` endpoints (the server
 * registers them only when not in production; see server.mjs). No login.
 */
export async function demoRequest<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = (await res.json()) as { error?: string };
      message = data.error ?? message;
    } catch {
      /* keep statusText */
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  return res.json() as Promise<T>;
}

export const demoConnectToken = () =>
  demoRequest<{ connect_token: string }>("/api/demo/connect-token");
export const demoAvatars = () =>
  demoRequest<{ items: CatalogItem[] }>("/api/demo/avatars");
export const demoScenes = () =>
  demoRequest<{ items: CatalogItem[] }>("/api/demo/scenes");
export const demoVoices = () =>
  demoRequest<{ items: CatalogItem[] }>("/api/demo/voices");
export const demoAvatarMotions = (avatarId: string) =>
  demoRequest<{ items: MotionAsset[] }>(
    `/api/demo/avatars/${encodeURIComponent(avatarId)}/motions`,
  );
