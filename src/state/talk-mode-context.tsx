import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * How the user talks into the call: hold-to-talk (push-to-talk) or
 * voice-activated (Silero VAD). A user-level preference, persisted to
 * localStorage and mirrored on the theme context pattern. Default is PTT —
 * VAD is opt-in.
 */
export type TalkMode = "ptt" | "vad";

const STORAGE_KEY = "tagteam.talkMode";

function readStoredTalkMode(): TalkMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "ptt" || stored === "vad" ? stored : "ptt";
}

type TalkModeContextValue = {
  talkMode: TalkMode;
  setTalkMode: (mode: TalkMode) => void;
};

const TalkModeContext = createContext<TalkModeContextValue | null>(null);

export function TalkModeProvider({ children }: { children: ReactNode }) {
  const [talkMode, setTalkModeState] = useState<TalkMode>(() => {
    if (typeof window === "undefined") return "ptt";
    return readStoredTalkMode();
  });

  const setTalkMode = useCallback((next: TalkMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    setTalkModeState(next);
  }, []);

  const value = useMemo<TalkModeContextValue>(
    () => ({ talkMode, setTalkMode }),
    [talkMode, setTalkMode],
  );

  return <TalkModeContext.Provider value={value}>{children}</TalkModeContext.Provider>;
}

export function useTalkMode(): TalkModeContextValue {
  const ctx = useContext(TalkModeContext);
  if (!ctx) throw new Error("useTalkMode must be used within TalkModeProvider");
  return ctx;
}
