/**
 * Perxona Connect API client + shared token manager. ONE Connect identity
 * (from env, injected by the caller) shared by every visitor — no per-user
 * login. `server.mjs` mints browser-facing connect_tokens from this and
 * proxies the catalog; the real credentials never reach the browser.
 */

/** @param {{ baseUrl: string, email: string, password: string }} opts */
export function createConnectClient({ baseUrl, email, password }) {
  async function callUpstream(upstreamPath, opts = {}, token) {
    // Every upstream call gets a deadline — a hung Connect call used to hang
    // forever (worst offender: the connect-chatbot nextTurn brain, which had
    // no signal at all and could wedge a session's audio pipeline
    // indefinitely). An external `signal` (e.g. the orchestrator's overall
    // retry-loop deadline) can additionally cut it short, but never extend it.
    const { timeoutMs = 20_000, headers: optHeaders, signal: externalSignal, ...rest } = opts;
    const headers = { "Content-Type": "application/json", ...optHeaders };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const attemptCap = AbortSignal.timeout(timeoutMs);
    return fetch(`${baseUrl}${upstreamPath}`, {
      ...rest,
      headers,
      signal: externalSignal ? AbortSignal.any([attemptCap, externalSignal]) : attemptCap,
    });
  }

  async function upstreamJson(res, label) {
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`upstream ${label} failed`), {
        status: res.status,
        payload,
      });
    }
    return res.json();
  }

  const connectApi = {
    async login(body) {
      const res = await callUpstream("/api/v1/connect/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return upstreamJson(res, "login");
    },

    async voices(token) {
      const res = await callUpstream("/api/v1/connect/voices", {}, token);
      return upstreamJson(res, "voices");
    },

    async avatars(token) {
      const res = await callUpstream("/api/v1/connect/assets/avatars", {}, token);
      const page = await upstreamJson(res, "avatars");
      return {
        ...page,
        items: (page.items ?? []).map(({ avatar_id, ...rest }) => ({
          id: avatar_id,
          ...rest,
        })),
      };
    },

    async motions(token, avatarId) {
      const res = await callUpstream(
        `/api/v1/connect/assets/avatars/${encodeURIComponent(avatarId)}/motions?size=100`,
        {},
        token,
      );
      const page = await upstreamJson(res, "motions");
      return {
        ...page,
        items: (page.items ?? []).map(({ motion_id, ...rest }) => ({
          id: motion_id,
          ...rest,
        })),
      };
    },

    /** One stateless Connect Chatbot turn (Phase 5d — nextTurn backend). The
     *  persona lives in the chatbot's custom_instructions; the caller's full
     *  context is sent as a single user message. Returns the reply text. */
    async chatbotChat(token, chatbotId, content, { signal } = {}) {
      const res = await callUpstream(
        `/api/v1/connect/chatbots/${encodeURIComponent(chatbotId)}/chat`,
        {
          method: "POST",
          body: JSON.stringify({
            messages: [{ role: "user", parts: [{ type: "text", text: content }] }],
          }),
          // Same budget as the own-LLM nextTurn path (providers.mjs llmChat) —
          // this is the alternative brain and can legitimately reason as long.
          timeoutMs: 120_000,
          signal,
        },
        token,
      );
      const payload = await upstreamJson(res, "chatbot chat");
      if (payload.status === "failed" || typeof payload.reply_text !== "string") {
        throw Object.assign(new Error("The chatbot did not produce a reply."), { status: 502 });
      }
      return payload.reply_text;
    },

    async scenes(token) {
      const res = await callUpstream("/api/v1/connect/assets/scenes", {}, token);
      const page = await upstreamJson(res, "scenes");
      return {
        ...page,
        items: (page.items ?? []).map(({ scene_id, ...rest }) => ({
          id: scene_id,
          ...rest,
        })),
      };
    },

    async checkUpstream() {
      try {
        const res = await fetch(`${baseUrl}/ready`);
        return res.ok ? "reachable" : "unreachable";
      } catch {
        return "unreachable";
      }
    },
  };

  let cachedToken = null;
  let loginPromise = null;

  async function getToken({ forceRefresh = false } = {}) {
    if (cachedToken && !forceRefresh) return cachedToken;
    if (forceRefresh) cachedToken = null;
    if (!loginPromise) {
      loginPromise = connectApi
        .login({ email, password })
        .then(({ access_token }) => {
          cachedToken = access_token;
          return cachedToken;
        })
        .finally(() => {
          loginPromise = null;
        });
    }
    return loginPromise;
  }

  async function authedCall(fn) {
    const token = await getToken();
    try {
      return await fn(token);
    } catch (err) {
      if (err.status !== 401 && err.status !== 403) throw err;
      const freshToken = await getToken({ forceRefresh: true });
      return fn(freshToken);
    }
  }

  return { connectApi, authedCall };
}
