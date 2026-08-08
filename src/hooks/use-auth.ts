import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import * as auth from "@/lib/auth";

export function useAuth() {
  const token = useSyncExternalStore(auth.subscribe, auth.getToken);
  const email = useSyncExternalStore(auth.subscribe, auth.getEmail);

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<Error | null>(null);
  const inFlight = useRef(false);

  const login = useCallback(async (loginEmail: string, password: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      await auth.login(loginEmail, password);
    } catch (err) {
      setLoginError(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      inFlight.current = false;
      setIsLoggingIn(false);
    }
  }, []);

  const logout = useCallback(() => auth.logout(), []);

  return {
    isAuthenticated: !!token,
    email,
    login,
    isLoggingIn,
    loginError,
    logout,
  };
}
