import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GlossaryEntry,
  HoldHelp,
  PlayerState,
  ScriptPlayerEvents,
  ScriptPlayerHandle,
  SimScript,
  TapHelp,
} from "@/shared/contract";

/**
 * MERGE POINT for connect-core. These four hooks are the demo implementations
 * of the connect-core hooks in src/hooks/* (use-auth.ts, use-catalog.ts,
 * use-avatar-session.ts, use-script-player.ts). When those land, swap each
 * wrapper's body for a delegation to the real hook — keep the return shapes
 * below so the UI screens do not change.
 *
 * The script player is a fully functional simulation: it advances turn by turn,
 * fires the contract events, and implements hold/resume/tapHelp semantics.
 */

export type CatalogItem = { id: string; name: string; description?: string };
export type AuthUser = { email: string };
export type AvatarLaunch = { avatarId: string; sceneId: string; voiceId: string };

const DEMO_AVATARS: CatalogItem[] = [
  { id: "avatar-kenji", name: "Kenji", description: "Composed section chief" },
  { id: "avatar-yuki", name: "Yuki", description: "Friendly desk clerk" },
  { id: "avatar-taro", name: "Taro", description: "Calm senior officer" },
];

const DEMO_SCENES: CatalogItem[] = [
  { id: "scene-ward-office", name: "Ward Office Counter", description: "Busy resident affairs counter" },
  { id: "scene-conference", name: "Consultation Room", description: "Quiet private meeting room" },
  { id: "scene-phone-counter", name: "Phone Service Desk", description: "Phone-based support desk" },
];

const DEMO_VOICES: CatalogItem[] = [
  { id: "voice-ja-mio", name: "Mio", description: "Clear female · ja-JP" },
  { id: "voice-ja-kenji", name: "Kenji", description: "Steady male · ja-JP" },
  { id: "voice-ja-yuki", name: "Yuki", description: "Soft female · ja-JP" },
];

const USER_STORAGE_KEY = "tagteam.demo.user";

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export type AuthResult = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  busy: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

export function useAuth(): AuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = window.sessionStorage.getItem(USER_STORAGE_KEY);
    if (saved) setUser({ email: saved });
  }, []);

  const login = useCallback(async (email: string, _password: string) => {
    setBusy(true);
    await sleep(550);
    window.sessionStorage.setItem(USER_STORAGE_KEY, email);
    setUser({ email });
    setBusy(false);
  }, []);

  const logout = useCallback(() => {
    window.sessionStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
  }, []);

  return useMemo(
    () => ({ user, isAuthenticated: user !== null, busy, login, logout }),
    [user, busy, login, logout],
  );
}

export type CatalogResult = {
  avatars: CatalogItem[];
  scenes: CatalogItem[];
  voices: CatalogItem[];
  loading: boolean;
  error: string | null;
};

export function useCatalog(): CatalogResult {
  return useMemo(
    () => ({
      avatars: DEMO_AVATARS,
      scenes: DEMO_SCENES,
      voices: DEMO_VOICES,
      loading: false,
      error: null,
    }),
    [],
  );
}

export type AvatarSessionResult = {
  launched: boolean;
  current: AvatarLaunch | null;
  isSpeaking: boolean;
  speakingText: string;
  launch: (avatarId: string, sceneId: string, voiceId: string) => void;
  speak: (text: string) => void;
  resumeAudio: () => Promise<void>;
};

export function useAvatarSession(): AvatarSessionResult {
  const [launched, setLaunched] = useState(false);
  const [current, setCurrent] = useState<AvatarLaunch | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingText, setSpeakingText] = useState("");
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const t = timerRef.current;
    return () => window.clearTimeout(t);
  }, []);

  const launch = useCallback((avatarId: string, sceneId: string, voiceId: string) => {
    setCurrent({ avatarId, sceneId, voiceId });
    setLaunched(true);
  }, []);

  const speak = useCallback((text: string) => {
    setIsSpeaking(true);
    setSpeakingText(text);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setIsSpeaking(false);
      setSpeakingText("");
    }, 1400);
  }, []);

  const resumeAudio = useCallback(async () => {
    /* the real SDK must resume audio from the Start-call gesture; it may reject
       if the AudioContext is closed. Demo: resolve after a tick. */
    await sleep(50);
  }, []);

  return useMemo(
    () => ({ launched, current, isSpeaking, speakingText, launch, speak, resumeAudio }),
    [launched, current, isSpeaking, speakingText, launch, speak, resumeAudio],
  );
}

export type ScriptPlayerOptions = {
  /** what the demo player uses to "speak" a turn. */
  speak?: (text: string) => void;
};

const utteranceMs = (text: string) =>
  Math.min(6500, Math.max(1400, text.length * 110));

export function useScriptPlayer(options?: ScriptPlayerOptions): ScriptPlayerHandle {
  const speakRef = useRef(options?.speak);
  speakRef.current = options?.speak;

  const scriptRef = useRef<SimScript | null>(null);
  const glossaryRef = useRef<GlossaryEntry[]>([]);
  const indexRef = useRef(0);
  const holdRef = useRef(false);
  const stateRef = useRef<PlayerState>("idle");
  const eventsRef = useRef<ScriptPlayerEvents>({});
  const timersRef = useRef<number[]>([]);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      timersRef.current.forEach((t) => window.clearTimeout(t));
      timersRef.current = [];
    };
  }, []);

  const changeState = useCallback((next: PlayerState) => {
    stateRef.current = next;
    eventsRef.current.onState?.(next);
  }, []);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    if (!aliveRef.current) return;
    timersRef.current.push(window.setTimeout(fn, ms));
  }, []);

  const advance = useCallback(() => {
    if (!aliveRef.current) return;
    const script = scriptRef.current;
    if (!script) {
      eventsRef.current.onSpeakingText?.("");
      changeState("ended");
      return;
    }
    if (holdRef.current) {
      changeState("held");
      return;
    }
    if (indexRef.current >= script.turns.length) {
      eventsRef.current.onSpeakingText?.("");
      changeState("ended");
      return;
    }
    const turn = script.turns[indexRef.current];
    indexRef.current += 1;
    eventsRef.current.onTurn?.(turn);
    if (turn.speaker === "bureaucrat") {
      eventsRef.current.onSpeakingText?.(turn.jp);
      speakRef.current?.(turn.jp);
      schedule(advance, utteranceMs(turn.jp));
    } else {
      eventsRef.current.onSpeakingText?.("");
      schedule(advance, 1700);
    }
  }, [changeState, schedule]);

  const load = useCallback(
    (script: SimScript, glossary: GlossaryEntry[]) => {
      clearTimers();
      scriptRef.current = script;
      glossaryRef.current = glossary;
      indexRef.current = 0;
      holdRef.current = false;
      changeState("idle");
    },
    [clearTimers, changeState],
  );

  const play = useCallback(() => {
    if (!scriptRef.current) return;
    if (stateRef.current !== "idle" && stateRef.current !== "held") return;
    holdRef.current = false;
    changeState("talking");
    schedule(advance, 400);
  }, [advance, changeState, schedule]);

  const resume = useCallback(() => {
    if (stateRef.current !== "held" && !holdRef.current) return;
    holdRef.current = false;
    changeState("talking");
    schedule(advance, 400);
  }, [advance, changeState, schedule]);

  const hold = useCallback(async (): Promise<HoldHelp> => {
    const currentIdx = Math.max(0, indexRef.current - 1);
    const turn = scriptRef.current?.turns[currentIdx];
    const found = (turn?.vocab ?? []).map((id) =>
      glossaryRef.current.find((g) => g.id === id),
    );
    const entries = found.filter((e): e is GlossaryEntry => Boolean(e));

    const jp = entries.length
      ? "はい、ゆっくりご説明いたします。" +
        entries
          .map(
            (e) =>
              `「${e.kanji}（${e.furigana}）」は「${e.en}」という意味です。${e.note ?? ""}`,
          )
          .join(" ") +
        "どうぞご確認ください。"
      : "はい、ご案内をゆっくり繰り返します。落ち着いてお聞きください。";
    const en = entries.length
      ? entries
          .map((e) => `${e.kanji} (${e.furigana}) means “${e.en}.” ${e.note ?? ""}`)
          .join(" ")
      : "The clerk will repeat the last point more slowly.";

    /* Carry the current turn's motion markup through so the real SDK plays the
       holding motion when it presents the verbal breakdown. */
    const motion = turn?.motion ?? "";
    const jpWithMotion = motion ? `${jp} ${motion}` : jp;

    holdRef.current = true;
    if (stateRef.current !== "talking") changeState("held");
    speakRef.current?.(jpWithMotion);
    return { explanationJp: jpWithMotion, explanationEn: en };
  }, [changeState]);

  const tapHelp = useCallback((entryId: string): TapHelp | null => {
    const entry = glossaryRef.current.find((g) => g.id === entryId);
    if (!entry) return null;
    return {
      entryId,
      hint: `${entry.kanji} (${entry.furigana}) — ${entry.en}.${entry.note ? ` ${entry.note}` : ""}`,
    };
  }, []);

  const interrupt = useCallback(() => {
    clearTimers();
    holdRef.current = false;
    indexRef.current = 0;
    eventsRef.current.onSpeakingText?.("");
    changeState("idle");
  }, [clearTimers, changeState]);

  const setEvents = useCallback((events: ScriptPlayerEvents) => {
    eventsRef.current = events;
  }, []);

  const getState = useCallback(() => stateRef.current, []);

  return useMemo(
    () => ({ load, play, hold, resume, tapHelp, interrupt, setEvents, getState }),
    [load, play, hold, resume, tapHelp, interrupt, setEvents, getState],
  );
}
