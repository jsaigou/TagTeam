/** Express middleware shared across route modules. */
import { auth } from "./auth.mjs";
import { fromNodeHeaders } from "better-auth/node";

/** Require a valid better-auth session, else 401. Attaches `req.user`. */
export async function requireAuth(req, res, next) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.user = session.user;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}

/** Wrap an async route handler so a thrown `Error` (optionally with
 *  `.status`/`.payload`, e.g. from the Connect client or a provider) becomes
 *  the JSON error response instead of an unhandled rejection. */
export function route(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      const status = err.status ?? 502;
      res.status(status).json(err.payload ?? { error: String(err) });
    }
  };
}
