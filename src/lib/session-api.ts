/**
 * REST client for the Phase 2 session + ephemeral upload APIs (server.mjs).
 * All endpoints require a better-auth session cookie (same-origin).
 */
import type { SessionSummary } from "@/shared/contract";
import type { ApiError } from "./api";

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message =
      (data as { error?: string }).error ?? res.statusText;
    throw Object.assign(new Error(message), { status: res.status, data }) as ApiError;
  }
  return res.json() as Promise<T>;
}

/** Create a fresh app session (with a fresh pairing code). */
export const createSession = () =>
  jsonRequest<SessionSummary>("/api/sessions", { method: "POST" });

/** The user's most recent active session, or null. */
export const getCurrentSession = async (): Promise<SessionSummary | null> => {
  try {
    return await jsonRequest<SessionSummary>("/api/sessions/current");
  } catch (err) {
    if ((err as ApiError).status === 404) return null;
    throw err;
  }
};

/** Rotate the pairing code of an existing session. */
export const rotatePairing = (sessionId: string) =>
  jsonRequest<SessionSummary>(`/api/sessions/${sessionId}/rotate-pairing`, {
    method: "POST",
  });

export type UploadResult = {
  uploadId: string;
  filename: string;
  mimeType: string;
  expiresAt: number;
};

/** Upload a scanned page (base64 JSON body). Returns the ephemeral upload id. */
export async function uploadPage(
  page: { filename: string; mimeType: string; dataUrl: string },
): Promise<UploadResult> {
  const contentBase64 = dataUrlToBase64(page.dataUrl);
  return jsonRequest<UploadResult>("/api/uploads", {
    method: "POST",
    body: JSON.stringify({
      filename: page.filename,
      content_base64: contentBase64,
      mime_type: page.mimeType,
    }),
  });
}

/** Fetch an uploaded page as a data URL (stage device consumes companion pages). */
export async function fetchUploadDataUrl(uploadId: string): Promise<string> {
  const res = await fetch(`/api/uploads/${uploadId}`, { headers: { Accept: "image/*" } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = (data as { error?: string }).error ?? res.statusText;
    throw Object.assign(new Error(message), { status: res.status, data }) as ApiError;
  }
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

/** Discard an uploaded page without acking it (safety cleanup). */
export const deleteUpload = (uploadId: string) =>
  fetch(`/api/uploads/${uploadId}`, { method: "DELETE" });

export function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl;
  return dataUrl.slice(comma + 1);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read blob"));
    reader.readAsDataURL(blob);
  });
}
