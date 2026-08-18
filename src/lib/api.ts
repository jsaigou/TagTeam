import { getPresenterUrl } from "./env";

export interface CatalogItem {
  id: string;
  name: string;
  thumbnail_urls?: Record<string, string>;
}

export interface AppConfig {
  presenterUrl: string;
}

export interface ApiError extends Error {
  status?: number;
  data?: unknown;
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      (data as { error?: string }).error ?? res.statusText;
    throw Object.assign(new Error(message), {
      status: res.status,
      data,
    }) as ApiError;
  }
  return res.json() as Promise<T>;
}

/** Presenter CDN URL — the engine loads from here (env or region default). */
export const getConfig = (): Promise<AppConfig> =>
  Promise.resolve({ presenterUrl: getPresenterUrl() });

export const getAvatars = () =>
  request<{ items: CatalogItem[] }>("/api/avatars");

/** A single motion asset in an avatar's motion catalog (Phase 4 browser). */
export interface MotionAsset {
  id: string;
  name: string;
  tags?: string[];
  thumbnail?: string | null;
}

export const getAvatarMotions = (avatarId: string) =>
  request<{ items: MotionAsset[] }>(`/api/avatars/${encodeURIComponent(avatarId)}/motions`);

export const getScenes = () =>
  request<{ items: CatalogItem[] }>("/api/scenes");

export const getVoices = () =>
  request<{ items: CatalogItem[] }>("/api/voices");

/** Mint a fresh Connect Kit bearer token from the backend proxy. The backend
 *  holds the real Connect credentials in env and never ships them to the browser. */
export const getConnectToken = () =>
  request<{ connect_token: string }>("/api/connect-token");

export type ReferenceResult = {
  query: string;
  results: { title: string; url: string; snippet: string }[];
  digest: string;
};

/** Web-search reference info (via the backend's SearXNG + Firecrawl). */
export const searchReference = (q: string) =>
  request<ReferenceResult>(`/api/search?q=${encodeURIComponent(q)}`);
