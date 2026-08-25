/** Connect catalog routes: token mint + avatars/scenes/voices/motions, plus
 *  the dev-only unauthenticated mirror used by the avatar-effects demos. */
import express from "express";
import { requireAuth, route } from "../middleware.mjs";
import { rateLimit } from "../rate-limit.mjs";

/** @param {{ connectApi: object, authedCall: Function, presenterUrl: string }} deps */
export function createCatalogRoutes({ connectApi, authedCall, presenterUrl }) {
  const router = express.Router();

  router.get("/api/health", async (_req, res) => {
    res.json({ status: "ok", upstream: await connectApi.checkUpstream() });
  });

  router.get("/api/config", (_req, res) => {
    res.json({ presenterUrl });
  });

  // Mints the Connect Kit bearer token for the browser. <sv-presenter> then
  // talks to the Connect API directly with it — this server only ever holds
  // the real credentials (env) and never ships them to the browser.
  router.get(
    "/api/connect-token",
    requireAuth,
    route(async (_req, res) => {
      res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
      const connectToken = await authedCall(async (token) => {
        await connectApi.voices(token);
        return token;
      });
      res.json({ connect_token: connectToken });
    }),
  );

  router.get(
    "/api/voices",
    requireAuth,
    route(async (_req, res) => {
      res.json(await authedCall((token) => connectApi.voices(token)));
    }),
  );

  router.get(
    "/api/avatars",
    requireAuth,
    route(async (_req, res) => {
      res.json(await authedCall((token) => connectApi.avatars(token)));
    }),
  );

  // Motion catalog for one avatar (Phase 4 motion browser). Motions are
  // per-avatar — never reuse guide motions on practice avatars.
  router.get(
    "/api/avatars/:avatarId/motions",
    requireAuth,
    rateLimit("avatars-motions", { windowMs: 60_000, max: 30 }),
    route(async (req, res) => {
      const { avatarId } = req.params;
      if (typeof avatarId !== "string" || !avatarId) {
        res.status(400).json({ error: "Missing avatar id." });
        return;
      }
      res.json(await authedCall((token) => connectApi.motions(token, avatarId)));
    }),
  );

  router.get(
    "/api/scenes",
    requireAuth,
    route(async (_req, res) => {
      res.json(await authedCall((token) => connectApi.scenes(token)));
    }),
  );

  // ── Demo sandbox API (dev only) ───────────────────────────────────────────
  // The avatar-effects demo (`/demo` in dev, separate Vite entry) has no login
  // screen, so it needs an unauthenticated token mint + catalog. Registered
  // only when NOT in production (the Docker runtime sets NODE_ENV=production)
  // or when explicitly opted in with ENABLE_DEMO_API=1. The minted token is
  // the same shared Connect identity the authed endpoints use — never
  // per-user secrets.
  const DEMO_API_ENABLED =
    process.env.NODE_ENV !== "production" || process.env.ENABLE_DEMO_API === "1";

  if (DEMO_API_ENABLED) {
    if (process.env.NODE_ENV === "production") {
      // Loud on purpose: this only fires when someone explicitly set
      // ENABLE_DEMO_API=1 in a production-flagged environment — worth a line
      // in the startup log every time, not just a silent opt-in.
      console.warn(
        "[catalog] Demo API is ENABLED in a NODE_ENV=production environment " +
          "(ENABLE_DEMO_API=1). These routes are unauthenticated — disable ENABLE_DEMO_API unless this is intentional.",
      );
    }

    router.get(
      "/api/demo/connect-token",
      rateLimit("demo-connect-token", { windowMs: 60_000, max: 30 }),
      route(async (_req, res) => {
        res.set({ "Cache-Control": "no-store", Pragma: "no-cache" });
        const connectToken = await authedCall(async (token) => {
          await connectApi.voices(token);
          return token;
        });
        res.json({ connect_token: connectToken });
      }),
    );

    router.get(
      "/api/demo/avatars",
      rateLimit("demo-avatars", { windowMs: 60_000, max: 30 }),
      route(async (_req, res) => {
        res.json(await authedCall((token) => connectApi.avatars(token)));
      }),
    );

    router.get(
      "/api/demo/scenes",
      rateLimit("demo-scenes", { windowMs: 60_000, max: 30 }),
      route(async (_req, res) => {
        res.json(await authedCall((token) => connectApi.scenes(token)));
      }),
    );

    router.get(
      "/api/demo/voices",
      rateLimit("demo-voices", { windowMs: 60_000, max: 30 }),
      route(async (_req, res) => {
        res.json(await authedCall((token) => connectApi.voices(token)));
      }),
    );

    router.get(
      "/api/demo/avatars/:avatarId/motions",
      rateLimit("demo-avatars-motions", { windowMs: 60_000, max: 30 }),
      route(async (req, res) => {
        const { avatarId } = req.params;
        if (typeof avatarId !== "string" || !avatarId) {
          res.status(400).json({ error: "Missing avatar id." });
          return;
        }
        res.json(await authedCall((token) => connectApi.motions(token, avatarId)));
      }),
    );
  }

  return router;
}
