/**
 * better-auth client (same-origin /api/auth). The app is gated behind a valid
 * session; server.mjs returns 401 for protected routes without one.
 */
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export type SessionUser = typeof authClient.$Infer.Session.user;
export type SessionData = typeof authClient.$Infer.Session;
