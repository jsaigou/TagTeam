import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { useAvatarSession, type AvatarSession } from "@/hooks/use-avatar-session";

/** A guide line. Spoken + shown in English; may embed specific Japanese words. */
export type GuideLine = { en: string };

/** Eager attention-getting motion (Luna / cc051_meeks): a friendly wave — not high energy. */
const EAGER_MOTIONS = [
  "01KD2H5BX9MXDJA5T9QY83QYS3", // Female Greeting Wave Hand
];
/** Luna's greeting wave for the Get Started door reveal. */
export const GREETING_WAVE_MOTION = EAGER_MOTIONS[0];
const EAGER_CADENCE_MS = 3400;

type AvatarContextValue = {
  stageRef: RefObject<HTMLDivElement | null>;
  session: AvatarSession;
  /** Resume the AudioContext from a user gesture so present()/speak() can play. */
  unlockAudio: () => Promise<void>;
  guide: GuideLine | null;
  /** Show a guide line WITHOUT speaking it (invite screen). */
  showGuide: (line: GuideLine | null) => void;
  /** Show a guide line; if audio is unlocked, speak it (English). */
  speakGuide: (line: GuideLine | null) => void;
  /** Clear the current guide bubble (comic-bubble auto-dismiss). The persistent
   *  chat transcript keeps the text, so this only hides the transient bubble. */
  clearGuide: () => void;
  /** Loop eager wave/laugh motions to get the user's attention (no speech). */
  startEager: () => void;
  stopEager: () => void;
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
  const [guide, setGuide] = useState<GuideLine | null>(null);

  const speakGuide = useCallback(
    (line: GuideLine | null) => {
      setGuide(line);
      if (line) void session.speak(line.en).catch(() => {});
    },
    [session],
  );

  const showGuide = useCallback((line: GuideLine | null) => {
    setGuide(line);
  }, []);

  const clearGuide = useCallback(() => setGuide(null), []);

  /* Resumes the AudioContext from a user gesture (autoplay). Does NOT speak —
     speech is driven by explicit speakGuide()/player calls. */
  const unlockAudio = useCallback(async () => {
    await session.resumeAudio();
  }, [session]);

  /* Eager attention-getting loop (wave/laugh), no speech. */
  const eagerOnRef = useRef(false);
  const eagerTimersRef = useRef<number[]>([]);

  const stopEager = useCallback(() => {
    eagerOnRef.current = false;
    eagerTimersRef.current.forEach((t) => window.clearTimeout(t));
    eagerTimersRef.current = [];
  }, []);

  const startEager = useCallback(() => {
    if (eagerOnRef.current) return;
    eagerOnRef.current = true;
    const loop = () => {
      if (!eagerOnRef.current) return;
      const motion = EAGER_MOTIONS[Math.floor(Math.random() * EAGER_MOTIONS.length)];
      void session.playMotion(motion).catch(() => {});
      eagerTimersRef.current.push(window.setTimeout(loop, EAGER_CADENCE_MS));
    };
    loop();
  }, [session]);

  useEffect(() => {
    return () => {
      eagerOnRef.current = false;
      eagerTimersRef.current.forEach((t) => window.clearTimeout(t));
      eagerTimersRef.current = [];
    };
  }, []);

  const value = useMemo(
    () => ({
      stageRef,
      session,
      unlockAudio,
      guide,
      showGuide,
      speakGuide,
      clearGuide,
      startEager,
      stopEager,
    }),
    [session, unlockAudio, guide, showGuide, speakGuide, clearGuide, startEager, stopEager],
  );

  return <AvatarContext.Provider value={value}>{children}</AvatarContext.Provider>;
}

export function useAvatar(): AvatarContextValue {
  const ctx = useContext(AvatarContext);
  if (!ctx) throw new Error("useAvatar must be used within AvatarProvider");
  return ctx;
}
