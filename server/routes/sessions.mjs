/** App-session (QR pairing) + scenario persistence + ephemeral upload routes. */
import express from "express";
import crypto from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { requireAuth, route } from "../middleware.mjs";
import { rateLimit } from "../rate-limit.mjs";
import { isImageContent } from "../file-sniff.mjs";
import { buildReferenceDigest } from "../steps/planScenario.mjs";

/**
 * @param {{
 *   db: object, schema: object, uploadStore: object, orchestrator: object,
 *   getDeviceCount: (sessionId: string) => number,
 *   generatePairingCode: () => string, pairingTtlMs: number,
 *   scenarios: { createScenario: Function, getScenario: Function, listScenarios: Function, updateScenario: Function, deleteScenario: Function },
 * }} deps
 */
export function createSessionsRoutes({
  db,
  schema,
  uploadStore,
  orchestrator,
  getDeviceCount,
  generatePairingCode,
  pairingTtlMs,
  scenarios: { createScenario, getScenario, listScenarios, updateScenario, deleteScenario },
}) {
  const router = express.Router();

  // ── Session hub (Phase 2) ─────────────────────────────────────────────────
  // QR-able app sessions + ephemeral upload store. The pairing code is the
  // bearer for the WS join; the phone can type it if it cannot scan.

  function buildOrigin(req) {
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin) return origin.replace(/\/+$/, "");
    // No Origin header (e.g. same-origin GET) — derive from forwarded headers
    // so the QR join URL and hub wsUrl use https/wss behind a TLS-terminating
    // proxy.
    const proto = String(req.protocol || "http").split(",")[0];
    const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0];
    return `${proto}://${host}`;
  }

  function toSessionSummary(row, req) {
    const origin = buildOrigin(req);
    return {
      id: row.id,
      status: row.status,
      pairingToken: row.pairingToken,
      pairingExpiresAt:
        row.pairingExpiresAt != null ? new Date(row.pairingExpiresAt).toISOString() : null,
      joinUrl: `${origin}/phone#s=${encodeURIComponent(row.id)}&p=${encodeURIComponent(row.pairingToken ?? "")}`,
      wsUrl: `${origin.replace(/^http/, "ws")}/api/ws`,
      deviceCount: getDeviceCount(row.id),
    };
  }

  async function ownedSession(req, res) {
    const [row] = await db
      .select()
      .from(schema.appSession)
      .where(eq(schema.appSession.id, req.params.id))
      .limit(1);
    if (!row || row.userId !== req.user.id) {
      res.status(404).json({ error: "Session not found" });
      return null;
    }
    return row;
  }

  // Create an app session + fresh pairing code for the logged-in user.
  router.post(
    "/api/sessions",
    requireAuth,
    route(async (req, res) => {
      const pairingExpiresAt = new Date(Date.now() + pairingTtlMs);
      const [row] = await db
        .insert(schema.appSession)
        .values({
          id: crypto.randomUUID(),
          userId: req.user.id,
          status: "active",
          pairingToken: generatePairingCode(),
          pairingExpiresAt,
          createdAt: new Date(),
        })
        .returning();
      res.json(toSessionSummary(row, req));
    }),
  );

  // The user's most recent active session (reconnect path for the desktop). A
  // session whose pairing code has expired is NOT reusable — the desktop
  // needs a live code to join the hub, so it must look like a 404 (creates a
  // fresh one).
  router.get(
    "/api/sessions/current",
    requireAuth,
    route(async (req, res) => {
      const [row] = await db
        .select()
        .from(schema.appSession)
        .where(
          and(
            eq(schema.appSession.userId, req.user.id),
            gt(schema.appSession.pairingExpiresAt, new Date()),
          ),
        )
        .orderBy(desc(schema.appSession.createdAt))
        .limit(1);
      if (!row || row.status !== "active") {
        res.status(404).json({ error: "No active session" });
        return;
      }
      res.json(toSessionSummary(row, req));
    }),
  );

  router.get(
    "/api/sessions/:id",
    requireAuth,
    route(async (req, res) => {
      const row = await ownedSession(req, res);
      if (!row) return;
      res.json(toSessionSummary(row, req));
    }),
  );

  // Rotate the pairing code (e.g. it was leaked, or the previous one expired).
  router.post(
    "/api/sessions/:id/rotate-pairing",
    requireAuth,
    route(async (req, res) => {
      const row = await ownedSession(req, res);
      if (!row) return;
      const [updated] = await db
        .update(schema.appSession)
        .set({
          pairingToken: generatePairingCode(),
          pairingExpiresAt: new Date(Date.now() + pairingTtlMs),
        })
        .where(eq(schema.appSession.id, row.id))
        .returning();
      res.json(toSessionSummary(updated, req));
    }),
  );

  // The stage seeds the scenario context once at call start; the
  // orchestrator then runs `audio → stt → nextTurn` for any device in the
  // session.
  router.post(
    "/api/sessions/:id/call-context",
    requireAuth,
    rateLimit("call-context", { windowMs: 60_000, max: 10 }),
    express.json({ limit: "2mb" }),
    route(async (req, res) => {
      const row = await ownedSession(req, res);
      if (!row) return;
      const { script, glossary, summary, answers, reference, target, settings } = req.body ?? {};
      if (!script || !Array.isArray(script.turns) || !Array.isArray(glossary)) {
        res.status(400).json({ error: "'script' and 'glossary' are required." });
        return;
      }
      // Rebuild the reference digest from the confirmed target SERVER-SIDE,
      // via the same buildReferenceDigest() planScenario already wrote the
      // script from — so the live call is grounded in the identical cited
      // rules, not a separately-sourced `reference` string that could drift
      // from what the script actually says. `reference` is the fallback for
      // calls that never had a confirmed target (the legacy search-only path).
      const groundedReference = buildReferenceDigest(target) ?? reference;
      orchestrator.setContext(row.id, {
        script,
        glossary,
        summary,
        answers,
        reference: groundedReference,
        settings,
      });
      res.json({ ok: true });
    }),
  );

  // ── Scenario persistence (Phase 5c) ───────────────────────────────────────
  // Full call state (grounding + settings + script + glossary + cheat sheet)
  // saved per user so a past call can be restored from the setup screen.
  router.get(
    "/api/scenarios",
    requireAuth,
    rateLimit("scenarios-list", { windowMs: 60_000, max: 30 }),
    route(async (req, res) => {
      res.json({ items: await listScenarios(req.user.id) });
    }),
  );

  router.post(
    "/api/scenarios",
    requireAuth,
    rateLimit("scenarios-create", { windowMs: 60_000, max: 10 }),
    express.json({ limit: "2mb" }),
    route(async (req, res) => {
      const { script, glossary } = req.body ?? {};
      if (!script || !Array.isArray(script.turns) || !Array.isArray(glossary)) {
        res.status(400).json({ error: "'script' and 'glossary' are required." });
        return;
      }
      const { id } = await createScenario(req.user.id, req.body);
      res.status(201).json({ id });
    }),
  );

  router.get(
    "/api/scenarios/:id",
    requireAuth,
    route(async (req, res) => {
      const scenario = await getScenario(req.user.id, req.params.id);
      if (!scenario) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      res.json(scenario);
    }),
  );

  router.put(
    "/api/scenarios/:id",
    requireAuth,
    rateLimit("scenarios-update", { windowMs: 60_000, max: 20 }),
    express.json({ limit: "2mb" }),
    route(async (req, res) => {
      const updated = await updateScenario(req.user.id, req.params.id, req.body ?? {});
      if (!updated) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      res.json(updated);
    }),
  );

  router.delete(
    "/api/scenarios/:id",
    requireAuth,
    route(async (req, res) => {
      const deleted = await deleteScenario(req.user.id, req.params.id);
      if (!deleted) {
        res.status(404).json({ error: "Scenario not found" });
        return;
      }
      res.json({ ok: true });
    }),
  );

  // Ephemeral page upload (base64 JSON — no multipart dependency). The bytes
  // live in the in-memory upload store for 10 minutes and are deleted on ack.
  router.post(
    "/api/uploads",
    requireAuth,
    express.json({ limit: "12mb" }),
    route(async (req, res) => {
      const { filename, content_base64, mime_type } = req.body ?? {};
      if (!filename || !content_base64) {
        res.status(400).json({ error: "'filename' and 'content_base64' are required." });
        return;
      }
      if (filename.includes("/") || filename.includes("\\")) {
        res.status(400).json({ error: "Invalid filename." });
        return;
      }
      const buffer = Buffer.from(content_base64, "base64");
      if (buffer.length === 0) {
        res.status(400).json({ error: "Empty file." });
        return;
      }
      // The client only gates this by File.type, which is browser-reported
      // and trivially spoofed — check the actual bytes are a real image
      // before this reaches document parsing / the phone-handoff flow.
      if (!isImageContent(buffer)) {
        res.status(400).json({ error: "File does not look like a supported image." });
        return;
      }
      const record = uploadStore.create({
        filename,
        mimeType: typeof mime_type === "string" ? mime_type : "image/jpeg",
        buffer,
        sessionId: typeof req.body.sessionId === "string" ? req.body.sessionId : undefined,
      });
      res.json(record);
    }),
  );

  router.get(
    "/api/uploads/:uploadId",
    requireAuth,
    route(async (req, res) => {
      const record = uploadStore.get(req.params.uploadId);
      if (!record) {
        res.status(404).json({ error: "Upload not found or expired" });
        return;
      }
      res.set({
        "Content-Type": record.mimeType,
        "Content-Length": record.buffer.length,
        "Cache-Control": "no-store",
      });
      res.end(record.buffer);
    }),
  );

  router.delete(
    "/api/uploads/:uploadId",
    requireAuth,
    route(async (req, res) => {
      uploadStore.remove(req.params.uploadId);
      res.status(204).end();
    }),
  );

  return router;
}
