import { useEffect, useRef, useState } from "react";

import type {
  GlossaryEntry,
  HoldHelp,
  PlayerState,
  ScriptPlayerEvents,
  ScriptPlayerHandle,
  SimScript,
  TapHelp,
  Turn,
} from "@/shared/contract";
import type { PresentationResult } from "@/lib/presenter";
import type { AvatarSession } from "./use-avatar-session";

export interface ScriptPlayerDeps {
  present: AvatarSession["present"];
  resumeAudio: AvatarSession["resumeAudio"];
  interrupt: AvatarSession["interrupt"];
  subscribe: AvatarSession["subscribe"];
}

const FALLBACK_HOLD_HELP: HoldHelp = {
  explanationJp: "ここまでです。また必要なときに、教えてください。",
  explanationEn: "That's all for now. Ask anytime if you need to pause again.",
};

export type PlayerInternals = ScriptPlayerHandle & {
  notifySpeakingText: (text: string) => void;
  notifyPerformanceState: (state: string) => void;
  notifyPerformanceEnd: () => void;
};

/**
 * Paces a SimScript through the presenter one turn at a time.
 *
 * Pause semantics (SDK has NO pause API): `hold()` stops advancing the queue at
 * the next turn boundary and speaks the breakdown; `resume()` continues. User
 * turns are natural pause points — the avatar cannot speak the user's line, so
 * the player waits for `resume()` there.
 */
export function useScriptPlayer(deps: ScriptPlayerDeps) {
  const playerRef = useRef<PlayerInternals | null>(null);
  if (!playerRef.current) {
    playerRef.current = createScriptPlayer(deps);
  }
  const player = playerRef.current;

  const [state, setState] = useState<PlayerState>("idle");
  const [currentTurn, setCurrentTurn] = useState<Turn | null>(null);

  useEffect(() => {
    const events: ScriptPlayerEvents = {
      onSpeakingText: () => {},
      onTurn: setCurrentTurn,
      onState: setState,
    };
    player.setEvents(events);
    return () => player.setEvents({});
  }, [player]);

  useEffect(() => {
    const offSpeaking = deps.subscribe("PLAYING_SPEECH_TEXT", (event) => {
      const { text } = (event as CustomEvent<{ text?: string }>).detail ?? {};
      player.notifySpeakingText(text ?? "");
    });
    const offPerformanceState = deps.subscribe("PERFORMANCE_STATE", (event) => {
      const { state: next } = (event as CustomEvent<{ state?: string }>).detail ?? {};
      player.notifyPerformanceState(next ?? "");
    });
    const offPerformanceEnd = deps.subscribe("PERFORMANCE_END", () => {
      player.notifyPerformanceEnd();
    });

    return () => {
      offSpeaking();
      offPerformanceState();
      offPerformanceEnd();
    };
  }, [deps, player]);

  return {
    player,
    state,
    currentTurn,
  };
}

export function createScriptPlayer(deps: ScriptPlayerDeps): PlayerInternals {
  let script: SimScript | null = null;
  let glossaryById = new Map<string, GlossaryEntry>();
  let turns: Turn[] = [];
  let index = 0;
  let state: PlayerState = "idle";
  let running = false;
  let paused = false;
  let pausedAtUser = false;
  let inSpeech = false;
  let audioResumed = false;
  let currentTurn: Turn | null = null;
  let events: ScriptPlayerEvents = {};
  let holdResolvers: Array<(help: HoldHelp) => void> = [];

  function setState(next: PlayerState) {
    state = next;
    events.onState?.(next);
  }

  function emitSpeakingText(text: string) {
    events.onSpeakingText?.(text);
  }

  function buildContent(turn: Turn): string {
    return turn.motion ? `${turn.motion} ${turn.jp}`.trim() : turn.jp;
  }

  function buildHoldHelp(turn: Turn | null): HoldHelp {
    if (!turn) return FALLBACK_HOLD_HELP;
    const glosses = turn.vocab
      .map((id) => glossaryById.get(id)?.en)
      .filter((en): en is string => !!en)
      .join("; ");
    return {
      explanationJp: `確認のため、もう一度言います。${turn.jp}`,
      explanationEn: turn.en ?? glosses ?? "Hold help",
    };
  }

  function advance() {
    if (!running || paused || pausedAtUser) return;
    if (index >= turns.length) {
      running = false;
      inSpeech = false;
      currentTurn = null;
      setState("ended");
      return;
    }

    const turn = turns[index];
    index += 1;
    currentTurn = turn;
    events.onTurn?.(turn);

    if (turn.speaker === "user") {
      pausedAtUser = true;
      return;
    }

    setState("talking");
    inSpeech = true;
    void speakTurn(buildContent(turn));
  }

  async function speakTurn(content: string) {
    if (!audioResumed) {
      try {
        await deps.resumeAudio();
      } catch {
        // AudioContext unavailable; present() will report a failure result.
      }
      audioResumed = true;
    }
    const result: PresentationResult | undefined = await deps.present(content);
    if (!running) return;
    if (result && !result.success) {
      running = false;
      inSpeech = false;
      setState("idle");
    }
  }

  function applyHoldBoundary() {
    if (!paused) return;
    pausedAtUser = false;
    setState("held");
    const help = buildHoldHelp(currentTurn ?? turns[index] ?? null);
    const resolvers = holdResolvers;
    holdResolvers = [];
    for (const resolve of resolvers) resolve(help);
    if (help.explanationJp) void speakTurn(help.explanationJp);
  }

  return {
    load(nextScript: SimScript, glossary: GlossaryEntry[]) {
      script = nextScript;
      turns = [...nextScript.turns];
      glossaryById = new Map(glossary.map((entry) => [entry.id, entry]));
      index = 0;
      currentTurn = null;
      running = false;
      paused = false;
      pausedAtUser = false;
      inSpeech = false;
      const resolvers = holdResolvers;
      holdResolvers = [];
      for (const resolve of resolvers) resolve(FALLBACK_HOLD_HELP);
      setState("idle");
    },

    play() {
      if (!script || turns.length === 0 || running) return;
      index = 0;
      running = true;
      paused = false;
      pausedAtUser = false;
      setState("talking");
      advance();
    },

    hold(): Promise<HoldHelp> {
      return new Promise((resolve) => {
        if (!running) {
          resolve(buildHoldHelp(currentTurn ?? turns[index] ?? null));
          return;
        }
        paused = true;
        holdResolvers.push(resolve);
        if (!inSpeech) applyHoldBoundary();
      });
    },

    resume() {
      if (paused) {
        paused = false;
        // Cut any leftover breakdown speech so the next turn starts fresh.
        deps.interrupt();
        setState("talking");
        advance();
      } else if (pausedAtUser) {
        pausedAtUser = false;
        setState("talking");
        advance();
      }
    },

    tapHelp(entryId: string): TapHelp | null {
      const entry = glossaryById.get(entryId);
      if (!entry) return null;
      return { entryId, hint: entry.note ?? entry.en ?? entry.kanji };
    },

    interrupt() {
      deps.interrupt();
      running = false;
      paused = false;
      pausedAtUser = false;
      inSpeech = false;
      currentTurn = null;
      const resolvers = holdResolvers;
      holdResolvers = [];
      for (const resolve of resolvers) resolve(FALLBACK_HOLD_HELP);
      setState("idle");
    },

    setEvents(nextEvents: ScriptPlayerEvents) {
      events = nextEvents;
    },

    getState() {
      return state;
    },

    notifySpeakingText(text: string) {
      emitSpeakingText(text);
    },

    notifyPerformanceState(next: string) {
      if (next === "Talking" && running && !paused) {
        setState("talking");
      }
    },

    notifyPerformanceEnd() {
      if (!inSpeech || !running) return;
      inSpeech = false;
      if (paused) {
        applyHoldBoundary();
        return;
      }
      advance();
    },
  };
}
