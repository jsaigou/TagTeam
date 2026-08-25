/**
 * Shared fixed-window rate limiting core. One registry + one sweep interval
 * for every named limiter, instead of each call site (each `rateLimit(...)`
 * in server.mjs, each WS join check in hub.mjs) running its own `Map` and its
 * own `setInterval`. Callers pick a unique `name` per limiter; the window/max
 * for a name are fixed on first use.
 */
const registry = new Map(); // name -> { windowMs, max, hits: Map<key, {count, resetAt}> }
let sweepTimer = null;

function ensureSweep() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const limiter of registry.values()) {
      for (const [key, entry] of limiter.hits) {
        if (entry.resetAt <= now) limiter.hits.delete(key);
      }
    }
  }, 60_000);
  sweepTimer.unref?.();
}

function getLimiter(name, { windowMs, max }) {
  let limiter = registry.get(name);
  if (!limiter) {
    limiter = { windowMs, max, hits: new Map() };
    registry.set(name, limiter);
  }
  ensureSweep();
  return limiter;
}

/** Consume one hit of budget for `key` under limiter `name`. Returns false
 *  once `key` has exceeded `max` hits within `windowMs`. */
export function consume(name, key, opts) {
  const limiter = getLimiter(name, opts);
  const now = Date.now();
  const entry = limiter.hits.get(key);
  if (!entry || entry.resetAt <= now) {
    limiter.hits.set(key, { count: 1, resetAt: now + limiter.windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limiter.max;
}

/** Express middleware built on `consume`, keyed by authenticated user id (or
 *  IP for unauthenticated routes). */
export function rateLimit(name, opts) {
  return (req, res, next) => {
    const key = req.user?.id ?? req.ip ?? "anonymous";
    if (!consume(name, key, opts)) {
      res.status(429).json({ error: "Too many requests — please wait a moment and try again." });
      return;
    }
    next();
  };
}
