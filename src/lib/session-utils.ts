/**
 * Pure helpers for the Phase 2 session layer (join URL parsing, WS URL
 * derivation, app-status derivation). Kept framework-free for unit tests.
 */
import type { AppStatus, PlayerState } from "@/shared/contract";

/** Derive the hub WS URL from an http(s) origin (e.g. the phone's own origin). */
export function wsUrlFromOrigin(origin: string): string {
  return origin.replace(/^http/, "ws").replace(/\/+$/, "") + "/api/ws";
}

export type PhoneJoin = {
  sessionId?: string;
  pairingToken: string;
};

/**
 * Parse the phone join URL fragment (`#s=<sessionId>&p=<code>`).
 * The pairing code alone is enough to join (the server resolves it), so a
 * missing `s` is allowed — the user can type just the 6-char code.
 */
export function parsePhoneHash(hash: string): PhoneJoin | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const pairingToken = params.get("p") ?? params.get("pair");
  if (!pairingToken) return null;
  const sessionId = params.get("s") ?? params.get("session");
  return sessionId ? { sessionId, pairingToken } : { pairingToken };
}

/** True when the current location is a phone-join URL. */
export function isPhoneJoinUrl(pathname: string, hash: string): boolean {
  if (pathname === "/phone") return true;
  return parsePhoneHash(hash) !== null;
}

/**
 * Normalize a scanned QR payload into a join URL fragment the phone can adopt.
 * The desktop QR encodes a full `joinUrl` (e.g.
 * `https://host/phone#s=<id>&p=<code>`); a bare 6-char pairing code is also
 * accepted. Returns `null` when nothing joinable is present.
 */
export function joinHashFromQr(payload: string): string | null {
  const text = payload.trim();
  if (!text) return null;
  const fragment = text.includes("#") ? text.slice(text.indexOf("#")) : text;
  if (parsePhoneHash(fragment)) return fragment;
  const code = text.toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (code.length === 6) return `#p=${code}`;
  return null;
}

/** Map the app's screen + player state onto the broadcast {@link AppStatus}. */
export function deriveAppStatus(
  screen: string,
  playerState: PlayerState | undefined,
): AppStatus {
  if (screen === "call") {
    if (playerState === "ended") return "ended";
    if (playerState === "held") return "held";
    if (playerState === "talking") return "running";
  }
  if (screen === "cheat-sheet") return "ended";
  return "setup";
}
