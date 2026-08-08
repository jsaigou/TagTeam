import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useAvatarSession, type AvatarSession } from "@/hooks/use-avatar-session";

/** A guide line. Spoken + shown in English; may embed specific Japanese words. */
export type GuideLine = { en: string };

type AvatarContextValue = {
  stageRef: RefObject<HTMLDivElement | null>;
  session: AvatarSession;
  /** True once resumeAudio has run from a user gesture (autoplay unlocked). */
  audioUnlocked: boolean;
  /** Resume audio from a user gesture; then speak the current guide line. */
  unlockAudio: () => Promise<void>;
  guide: GuideLine | null;
  /** Show a guide line; if audio is unlocked, speak it (English). */
  speakGuide: (line: GuideLine | null) => void;
};

const AvatarContext = createContext<AvatarContextValue | null>(null);

/**
 * Owns the persistent <sv-presenter> mount and the shared avatar session so the
 * avatar is always on screen (the star) across every screen. Also owns the
 * guide-line state and the audio-unlock gesture.
 */
export function AvatarProvider({ children }: { children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const session = useAvatarSession(stageRef);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [guide, setGuide] = useState<GuideLine | null>(null);
  const guideRef = useRef<GuideLine | null>(null);

  const speakGuide = useCallback(
    (line: GuideLine | null) => {
      setGuide(line);
      guideRef.current = line;
      if (line) void session.speak(line.en).catch(() => {});
    },
    [session],
  );

  const unlockAudio = useCallback(async () => {
    await session.resumeAudio();
    setAudioUnlocked(true);
    const line = guideRef.current;
    if (line) void session.speak(line.en).catch(() => {});
  }, [session]);
  const value = useMemo(
    () => ({
      stageRef,
      session,
      audioUnlocked,
      unlockAudio,
      guide,
      speakGuide,
    }),
    [session, audioUnlocked, unlockAudio, guide, speakGuide],
  );

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useAvatar(): AvatarContextValue {
  const ctx = useContext(AvatarContext);
  if (!ctx) throw new Error("useAvatar must be used within AvatarProvider");
  return ctx;
}
