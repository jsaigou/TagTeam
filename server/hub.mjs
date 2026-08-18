/**
 * Phase 2 — WebSocket session hub + ephemeral upload store.
 *
 * Devices join a session room over WS (path `/api/ws`) using the pairing code
 * minted by `POST /api/sessions` (see server.mjs). The hub is authoritative
 * only about connectivity: who is in a room, which roles they hold, and the
 * most recent {@link AppSnapshot} the stage broadcast. All real state lives in
 * the stage device (desktop) — the hub relays it.
 *
 * Protocol mirrors docs/architecture.md §9:
 *   join → joined | devices     state → state      control → control (to stage)
 *   upload → upload (to stage)  ack → ack (broadcast)  ping/pong keepalive
 *
 * Uploads are kept in memory (ephemeral, 10-min TTL) — they never touch the DB.
 * The companion POSTs the page bytes, gets an uploadId, then announces it over
 * WS; the stage fetches it, and acks once it has consumed it, deleting the file.
 */
import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";
import { eq } from "drizzle-orm";

export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_TTL_MS = 15 * 60 * 1000;
export const UPLOAD_TTL_MS = 10 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOADS = 15;
const MAX_WS_MESSAGE_BYTES = 256 * 1024;

const DEVICE_CAPABILITIES = new Set(["stage", "input", "control"]);

export function generatePairingCode() {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return code;
}

/** In-memory ephemeral upload store with a TTL sweeper. */
export function createUploadStore({
  ttlMs = UPLOAD_TTL_MS,
  maxBytes = MAX_UPLOAD_BYTES,
  maxUploads = MAX_UPLOADS,
} = {}) {
  const items = new Map();
  let sweepTimer = null;

  function create({ filename, mimeType, buffer, sessionId }) {
    if (buffer.length > maxBytes) {
      const err = new Error("Upload exceeds the 8 MB limit.");
      err.code = "UPLOAD_TOO_LARGE";
      throw err;
    }
    sweep();
    if (items.size >= maxUploads) {
      const err = new Error("Too many pending uploads — ack or wait a moment.");
      err.code = "UPLOAD_STORE_FULL";
      throw err;
    }
    const uploadId = crypto.randomUUID();
    const record = {
      uploadId,
      filename,
      mimeType,
      buffer,
      sessionId,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    items.set(uploadId, record);
    return {
      uploadId,
      filename,
      mimeType,
      expiresAt: record.expiresAt,
    };
  }

  function get(uploadId) {
    return items.get(uploadId) ?? null;
  }

  function remove(uploadId) {
    return items.delete(uploadId);
  }

  function sweep() {
    const now = Date.now();
    for (const [id, item] of items) {
      if (item.expiresAt <= now) items.delete(id);
    }
  }

  function start() {
    if (sweepTimer) return;
    sweepTimer = setInterval(sweep, 60_000);
    if (sweepTimer.unref) sweepTimer.unref();
  }

  function stop() {
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  return { create, get, remove, sweep, start, stop };
}

/**
 * Attach the WS hub to an http.Server. Returns the hub handle
 * `{ uploadStore, getDeviceCount, rooms }`.
 */
export function attachHub(server, { db, schema, uploadStore }) {
  const store = uploadStore ?? createUploadStore();
  store.start();

  const wss = new WebSocketServer({ server, path: "/api/ws", maxPayload: MAX_WS_MESSAGE_BYTES });
  /** sessionId -> Map<deviceId, device> */
  const rooms = new Map();
  /** sessionId -> latest AppSnapshot broadcast by the stage (for re-joins). */
  const snapshots = new Map();

  /** Resolve an app_session from its (6-char, expiring) pairing code. */
  async function resolveSession(pairingToken) {
    if (typeof pairingToken !== "string" || !pairingToken.trim()) return null;
    const rows = await db
      .select()
      .from(schema.appSession)
      .where(eq(schema.appSession.pairingToken, pairingToken.trim()))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    if (row.status !== "active") return null;
    const expiresAt = row.pairingExpiresAt;
    if (expiresAt != null && new Date(expiresAt).getTime() < Date.now()) return null;
    return row;
  }

  function send(ws, message) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function sendError(ws, code, message) {
    send(ws, { type: "error", code, message });
  }

  function broadcast(sessionId, message) {
    const room = rooms.get(sessionId);
    if (!room) return;
    for (const device of room.values()) send(device.ws, message);
  }

  function sendDeviceList(sessionId) {
    const room = rooms.get(sessionId);
    if (!room) return;
    const devices = [...room.values()].map((d) => ({
      deviceId: d.deviceId,
      capabilities: d.capabilities,
      connected: d.ws.readyState === WebSocket.OPEN,
    }));
    broadcast(sessionId, { type: "devices", devices });
  }

  function relayToRole(sessionId, role, message) {
    const room = rooms.get(sessionId);
    if (!room) return;
    for (const device of room.values()) {
      if (device.roles.includes(role)) send(device.ws, message);
    }
  }

  async function handleJoin(ws, msg) {
    const caps = Array.isArray(msg.capabilities)
      ? [...new Set(msg.capabilities.filter((c) => DEVICE_CAPABILITIES.has(c)))]
      : [];
    const session = await resolveSession(msg.pairingToken);
    if (!session) {
      sendError(
        ws,
        "INVALID_PAIRING",
        "This pairing code is invalid or has expired. Ask the desktop for a fresh one.",
      );
      return;
    }
    const sessionId = session.id;
    let room = rooms.get(sessionId);
    if (!room) {
      room = new Map();
      rooms.set(sessionId, room);
    }

    let roles = caps;
    if (caps.includes("stage") && [...room.values()].some((d) => d.roles.includes("stage"))) {
      roles = caps.filter((c) => c !== "stage");
    }

    const deviceId = crypto.randomUUID();
    const device = { ws, deviceId, sessionId, capabilities: caps, roles };
    room.set(deviceId, device);
    ws.appSessionId = sessionId;
    ws.appDeviceId = deviceId;

    send(ws, {
      type: "joined",
      deviceId,
      roles,
      snapshot: snapshots.get(sessionId) ?? null,
    });
    sendDeviceList(sessionId);
  }

  function handleMessage(ws, msg) {
    const sessionId = ws.appSessionId;
    const room = sessionId ? rooms.get(sessionId) : null;
    const device = room?.get(ws.appDeviceId);
    if (!room || !device) {
      sendError(ws, "NOT_JOINED", "Join a session before sending messages.");
      return;
    }

    switch (msg.type) {
      case "state": {
        if (typeof msg.snapshot !== "object" || msg.snapshot === null) break;
        snapshots.set(sessionId, msg.snapshot);
        broadcast(sessionId, { type: "state", snapshot: msg.snapshot });
        break;
      }
      case "control": {
        if (msg.action !== "hold" && msg.action !== "resume" && msg.action !== "tapHelp") break;
        const out = { type: "control", action: msg.action };
        if (typeof msg.entryId === "string") out.entryId = msg.entryId;
        relayToRole(sessionId, "stage", out);
        break;
      }
      case "upload": {
        if (typeof msg.uploadId !== "string" || typeof msg.filename !== "string") break;
        // Only stage devices fetch uploaded pages.
        relayToRole(sessionId, "stage", {
          type: "upload",
          uploadId: msg.uploadId,
          filename: msg.filename,
        });
        break;
      }
      case "ack": {
        if (typeof msg.uploadId !== "string") break;
        store.remove(msg.uploadId);
        broadcast(sessionId, { type: "ack", uploadId: msg.uploadId });
        break;
      }
      case "ping":
        send(ws, { type: "pong" });
        break;
      default:
        break;
    }
  }

  wss.on("connection", (ws) => {
    ws.on("message", (data) => {
      if (data.length > MAX_WS_MESSAGE_BYTES) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        sendError(ws, "BAD_JSON", "Messages must be JSON.");
        return;
      }
      if (msg?.type === "join") {
        void handleJoin(ws, msg).catch((err) => {
          console.error("[hub] join failed:", err);
          sendError(ws, "INTERNAL", "Could not join the session right now.");
        });
        return;
      }
      handleMessage(ws, msg);
    });

    ws.on("close", () => {
      const sessionId = ws.appSessionId;
      const deviceId = ws.appDeviceId;
      if (!sessionId || !deviceId) return;
      const room = rooms.get(sessionId);
      if (!room) return;
      room.delete(deviceId);
      sendDeviceList(sessionId);
      if (room.size === 0) {
        rooms.delete(sessionId);
        snapshots.delete(sessionId);
      }
    });

    ws.on("error", () => {
      /* close handler cleans up */
    });
  });

  // Keepalive — drop dead connections so device lists stay accurate.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref?.();

  wss.on("close", () => clearInterval(heartbeat));

  function getDeviceCount(sessionId) {
    return rooms.get(sessionId)?.size ?? 0;
  }

  return { uploadStore: store, getDeviceCount, rooms };
}
