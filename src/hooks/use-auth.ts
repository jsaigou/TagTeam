import { authClient, type SessionData } from "@/lib/auth";

/** Current auth session. `isPending` while the session is being resolved. */
export function useAuth() {
  const { data: session, isPending, error } = authClient.useSession();
  return {
    session: (session as SessionData | null) ?? null,
    isPending,
    error: error as Error | null,
  };
}
