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
import { consume } from "./rate-limit.mjs";

export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PAIRING_TTL_MS = 15 * 60 * 1000;
export const UPLOAD_TTL_MS = 10 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_UPLOADS = 15;
const MAX_WS_MESSAGE_BYTES = 256 * 1024;
// Pairing codes are 6 chars over a 32-symbol alphabet (32^6 ≈ 10^9 space) —
// brute-forcing one by guessing `join` messages must be throttled per IP
// (across any number of connections) and a single connection that keeps
// guessing wrong codes must be dropped outright.
const JOIN_ATTEMPTS_PER_IP = { windowMs: 60_000, max: 20 };
const MAX_FAILED_JOINS_PER_CONNECTION = 5;

const DEVICE_CAPABILITIES = new Set(["stage", "input", "control"]);
// Message types that mutate run/audio state or feed the pipeline — refused
// from a device that joined without declaring any capability (roles.length
// === 0), since the hub otherwise never checks the sender's role for these.
const ROLE_GATED_TYPES = new Set(["audio", "intent", "confirm", "cancelRun", "upload", "ack"]);

/** Best-effort client IP for WS connections, honoring a TLS-terminating
 *  reverse proxy's X-Forwarded-For (server.mjs sets `trust proxy` for
 *  Express, but the `ws` upgrade path needs its own read of the header). */
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress ?? "unknown";
}

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
export function attachHub(
  server,
  {
    db,
    schema,
    uploadStore,
    orchestrator,
    // Phase 7b — background job runner (server/graph.mjs createRunEngine) and
    // the free-text classifier (server/intent.mjs) that decides when a `run`
    // starts or a gate resolves. Both optional: a hub with neither still
    // serves every pre-7b message unchanged.
    runEngine,
    classifyIntent,
    heartbeatMs = 30_000,
    roomEmptyGraceMs = 60_000,
  },
) {
  const store = uploadStore ?? createUploadStore();
  store.start();

  const wss = new WebSocketServer({ server, path: "/api/ws", maxPayload: MAX_WS_MESSAGE_BYTES });
  /** sessionId -> Map<deviceId, device> */
  const rooms = new Map();
  /** sessionId -> latest AppSnapshot broadcast by the stage (for re-joins). */
  const snapshots = new Map();
  /** sessionId -> latest RunSnapshot from runEngine (for re-joins). */
  const latestRun = new Map();
  /**
   * Conversation-first setup: sessionId -> the search candidate awaiting the
   * user's yes/no ("Ok, I'm searching for 'X'. Is that correct?"). The run was
   * ALREADY started (spec-parallel dispatch); a spoken/typed "no" cancels it.
   * Not a graph gate — research keeps running while we ask, which is the point.
   */
  const pendingCandidates = new Map();
  /** sessionId -> pending room-teardown timer (grace period for reconnects). */
  const roomCleanupTimers = new Map();

  const unsubscribeRunEngine = runEngine?.addListener((sessionId, run) => {
    latestRun.set(sessionId, run);
    broadcast(sessionId, { type: "run", run });
  });

  function cancelRoomCleanup(sessionId) {
    const timer = roomCleanupTimers.get(sessionId);
    if (!timer) return;
    clearTimeout(timer);
    roomCleanupTimers.delete(sessionId);
  }

  function scheduleRoomCleanup(sessionId) {
    cancelRoomCleanup(sessionId);
    const timer = setTimeout(() => {
      roomCleanupTimers.delete(sessionId);
      const room = rooms.get(sessionId);
      // Only tear down if the room is still empty — a device may have rejoined.
      if (room && room.size === 0) {
        rooms.delete(sessionId);
        snapshots.delete(sessionId);
        latestRun.delete(sessionId);
        pendingCandidates.delete(sessionId);
        orchestrator?.clear(sessionId);
        runEngine?.endSession(sessionId);
      }
    }, roomEmptyGraceMs);
    timer.unref?.();
    roomCleanupTimers.set(sessionId, timer);
  }

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
    if (!consume("ws-join", ws.clientIp, JOIN_ATTEMPTS_PER_IP)) {
      sendError(ws, "RATE_LIMITED", "Too many join attempts — please wait a moment and try again.");
      ws.close();
      return;
    }
    const caps = Array.isArray(msg.capabilities)
      ? [...new Set(msg.capabilities.filter((c) => DEVICE_CAPABILITIES.has(c)))]
      : [];
    const session = await resolveSession(msg.pairingToken);
    if (!session) {
      ws.failedJoins = (ws.failedJoins ?? 0) + 1;
      sendError(
        ws,
        "INVALID_PAIRING",
        "This pairing code is invalid or has expired. Ask the desktop for a fresh one.",
      );
      if (ws.failedJoins >= MAX_FAILED_JOINS_PER_CONNECTION) ws.close();
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
    // A device rejoined before the grace period elapsed — keep the room alive.
    cancelRoomCleanup(sessionId);

    send(ws, {
      type: "joined",
      deviceId,
      roles,
      snapshot: snapshots.get(sessionId) ?? null,
    });
    const run = latestRun.get(sessionId);
    if (run) send(ws, { type: "run", run });
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
    if (ROLE_GATED_TYPES.has(msg.type) && device.roles.length === 0) {
      sendError(ws, "FORBIDDEN", "This device has no declared role in the session.");
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
      // Phase 3 — push-to-talk audio: STT + adaptive nextTurn server-side, then
      // broadcast the transcribed user turn and the bureaucrat reply.
      case "audio":
        void handleAudio(sessionId, msg);
        break;
      case "ping":
        send(ws, { type: "pong" });
        break;
      // Phase 7b — free-text turn classified into a fixed action (never a
      // free tool call) and background research with a user-confirmed gate.
      case "intent":
        if (typeof msg.text === "string" && msg.text.trim())
          void handleIntent(sessionId, msg.text, msg.context);
        break;
      case "confirm": {
        if (typeof msg.runId !== "string") break;
        const candidateId = typeof msg.candidateId === "string" ? msg.candidateId : null;
        runEngine?.resolveGate(sessionId, msg.runId, candidateId);
        break;
      }
      case "cancelRun":
        if (typeof msg.runId === "string") runEngine?.cancelRun(sessionId, msg.runId);
        break;
      default:
        break;
    }
  }

  /** Classify free text into a fixed action; the model classifies, it never
   *  chooses what runs (Phase 7 plan §7b.4). No-ops if either dependency is
   *  unwired (a hub not configured for Phase 7b). `context` (the setup
   *  screen's document/answers/settings — see RunContext in the contract)
   *  seeds the run's ctx when the text states an objective. */
  async function handleIntent(sessionId, text, context) {
    if (!runEngine || !classifyIntent) return;
    const current = latestRun.get(sessionId);
    const pending = pendingCandidates.get(sessionId);
    // A pending search-candidate confirm counts as "gate open" so bare
    // yes/no fast-paths to confirm/reject (server/intent.mjs).
    const gateOpen = Boolean(current?.gate) || Boolean(pending);
    let result;
    try {
      result = await classifyIntent(text, { gateOpen });
    } catch (err) {
      console.error("[hub] intent classification failed:", err?.message ?? err);
      return;
    }
    /** Tell the devices how the turn was classified so the avatar speaks the
     *  matching dialogue; `runId` pins cancel/confirm to a specific run. */
    const classified = (extra = {}) => broadcast(sessionId, { type: "classified", result, ...extra });
    switch (result.intent) {
      case "state_objective": {
        const extra =
          context && typeof context === "object" && !Array.isArray(context) ? context : undefined;
        // Spec-parallel dispatch: the background run starts NOW; Luna asks
        // about the candidate while Gemma already searches. A new objective
        // supersedes any pending candidate (startRun cancels the old run).
        const snap = runEngine.startRun(sessionId, result.objective || text, extra);
        if (result.targetName) {
          pendingCandidates.set(sessionId, { name: result.targetName, runId: snap.runId });
          classified({ runId: snap.runId });
        } else {
          pendingCandidates.delete(sessionId);
          classified();
        }
        break;
      }
      case "confirm":
        if (current?.gate) {
          const candidateId = current.gate.guessId ?? current.gate.candidates[0]?.id ?? null;
          runEngine.resolveGate(sessionId, current.runId, candidateId);
        } else if (pending) {
          // Candidate confirmed — the parallel search simply continues.
          pendingCandidates.delete(sessionId);
        }
        classified({ ...(pending ? { runId: pending.runId } : {}) });
        break;
      case "reject":
        if (current?.gate) {
          runEngine.resolveGate(sessionId, current.runId, null);
          classified();
        } else if (pending) {
          // Wrong candidate — cancel the in-flight Gemma work immediately and
          // let the avatar ask for the correct name (or a letter/screenshot).
          runEngine.cancelRun(sessionId, pending.runId);
          pendingCandidates.delete(sessionId);
          latestRun.delete(sessionId);
          classified({ runId: pending.runId });
        } else {
          classified();
        }
        break;
      case "provide_url": {
        // A URL with nothing in flight IS the objective — the user points at
        // the office's webpage from the start instead of restating a task.
        // Mid-run (or gate open) it stays a no-op: the guide chat handles it.
        const runDelivered = Boolean(current?.result);
        if (!current || runDelivered) {
          const extra =
            context && typeof context === "object" && !Array.isArray(context)
              ? context
              : undefined;
          pendingCandidates.delete(sessionId);
          const snap = runEngine.startRun(sessionId, text, extra);
          classified({ runId: snap.runId });
        } else {
          classified();
        }
        break;
      }
      default:
        pendingCandidates.delete(sessionId);
        // question / other: no job in this slice — the guide
        // chat's normal LLM turn (client-side, unrelated to this hub) handles it.
        break;
    }
  }

  /** Runs the orchestrator on push-to-talk audio and broadcasts the outcome. */
  async function handleAudio(sessionId, msg) {
    if (typeof msg.audioId !== "string" || !msg.audioId) return;
    if (!orchestrator) {
      sendError(wsFor(sessionId), "STT_UNAVAILABLE", "Real conversation is not enabled on this server.");
      return;
    }
    const record = store.get(msg.audioId);
    if (!record) {
      sendError(wsFor(sessionId), "AUDIO_EXPIRED", "The audio expired before it could be processed — please try again.");
      return;
    }
    store.remove(msg.audioId);
    broadcast(sessionId, { type: "phase", phase: "thinking" });
    try {
      const { userTurn, replyTurn, end } = await orchestrator.handleAudio(sessionId, {
        buffer: record.buffer,
        mimeType: typeof msg.mimeType === "string" ? msg.mimeType : record.mimeType,
      });
      broadcast(sessionId, { type: "turn", turn: userTurn });
      broadcast(sessionId, { type: "turn", turn: replyTurn, ...(end ? { end: true } : {}) });
    } catch (err) {
      console.error("[hub] audio pipeline failed:", err?.message ?? err);
      const code =
        err?.status === 409
          ? "BUSY"
          : err?.status === 422
            ? "NOT_HEARD"
            : err?.status === 504
              ? "TIMEOUT"
              : "STT_FAILED";
      broadcast(sessionId, { type: "error", code, message: err?.message ?? "Could not process audio." });
    } finally {
      broadcast(sessionId, { type: "phase", phase: "idle" });
    }
  }

  /** The live WS of any device in a room (for targeted error replies). */
  function wsFor(sessionId) {
    const room = rooms.get(sessionId);
    return [...(room?.values() ?? [])][0]?.ws;
  }

  wss.on("connection", (ws, req) => {
    ws.clientIp = clientIp(req);
    ws.isAlive = true;
    ws.on("pong", () => {
      ws.isAlive = true;
    });

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
      // Don't tear down immediately — a refresh or a brief network blip empties
      // the room for a moment. Give devices a grace period to rejoin before the
      // transcript/context is discarded.
      if (room.size === 0) {
        scheduleRoomCleanup(sessionId);
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
  }, heartbeatMs);
  heartbeat.unref?.();

  wss.on("close", () => {
    clearInterval(heartbeat);
    unsubscribeRunEngine?.();
  });

  function getDeviceCount(sessionId) {
    return rooms.get(sessionId)?.size ?? 0;
  }

  return { uploadStore: store, getDeviceCount, rooms };
}
