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

export type ReferenceHit = { title: string; url: string; snippet: string };
export type ReferencePageEvent = { url: string; index: number; total: number };

/** Web-search reference info (via the backend's SearXNG + Firecrawl), streamed
 *  as Server-Sent Events so hits and scraped pages appear as they're found. */
export function streamSearchReference(
  q: string,
  callbacks: {
    onHits?: (query: string, results: ReferenceHit[]) => void;
    onPage?: (event: ReferencePageEvent) => void;
    onDone?: (result: ReferenceResult) => void;
    onError?: (message: string) => void;
  },
): () => void {
  const es = new EventSource(`/api/search?q=${encodeURIComponent(q)}`);

  es.addEventListener("hits", ((event: MessageEvent<string>) => {
    const data = JSON.parse(event.data) as { query: string; results: ReferenceHit[] };
    callbacks.onHits?.(data.query, data.results);
  }) as EventListener);

  es.addEventListener("page", ((event: MessageEvent<string>) => {
    callbacks.onPage?.(JSON.parse(event.data) as ReferencePageEvent);
  }) as EventListener);

  es.addEventListener("done", ((event: MessageEvent<string>) => {
    callbacks.onDone?.(JSON.parse(event.data) as ReferenceResult);
    es.close();
  }) as EventListener);

  es.addEventListener("error", ((event: MessageEvent<string>) => {
    if (event.data) {
      const data = JSON.parse(event.data) as { error: string };
      callbacks.onError?.(data.error);
    }
    es.close();
  }) as EventListener);

  es.onerror = () => {
    /* transient network drop — the server eventually closes on error/end */
  };

  return () => es.close();
}

/** One-shot search (blocks until the digest is ready) — used by callers that
 *  don't need streaming (e.g. tests). Prefer {@link streamSearchReference}. */
export const searchReference = (q: string): Promise<ReferenceResult> =>
  new Promise((resolve, reject) => {
    const close = streamSearchReference(q, {
      onDone: (result) => {
        close();
        resolve(result);
      },
      onError: (message) => {
        close();
        reject(new Error(message));
      },
    });
  });
