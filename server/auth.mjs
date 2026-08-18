/**
 * better-auth instance — email/password accounts stored in the shared SQLite DB.
 * Mounted at /api/auth/*; the app gates its routes behind a valid session.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";

import { db, schema } from "./db.mjs";

const PORT = process.env.PORT || 8083;
const BETTER_AUTH_URL =
  process.env.BETTER_AUTH_URL || `http://localhost:${PORT}`;

export const auth = betterAuth({
  baseURL: BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema,
    debugLogs: process.env.DEBUG === "1",
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh sliding expiration daily
  },
  trustedOrigins: [
    // Vite dev server (pnpm dev) proxies /api to this server, so the browser's
    // Origin header is http://localhost:5173 — better-auth would reject it.
    "http://localhost:5173",
    ...(process.env.TRUSTED_ORIGINS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ],
});
