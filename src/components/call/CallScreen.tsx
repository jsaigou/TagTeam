import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, Loader2, Mic, PhoneCall } from "lucide-react";
import type { HoldHelp, PlayerState, TapHelp, Turn } from "@/shared/contract";
import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { useSession } from "@/state/session-context";
import { useScriptPlayer } from "@/hooks/use-script-player";
import { usePushToTalk } from "@/hooks/use-push-to-talk";
import { setCallContext } from "@/lib/session-api";
import { createScenario, updateScenario } from "@/lib/scenario-api";
import { pipeline } from "@/state/pipeline";
import { DEFAULT_AVATAR_ID, DEFAULT_SCENE_ID, DEFAULT_VOICE_ID } from "@/lib/presets";
import { Transcript } from "./Transcript";
import { VocabOverlay } from "./VocabOverlay";
import { HelpLayer } from "./HelpLayer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export function CallScreen() {
  const {
    state,
    toCheatSheet,
    setCheatSheet,
    setBusy,
    setError,
    setScenarioId,
  } = useAppStore();
  const { session: avatar, unlockAudio, speakGuide } = useAvatar();
  const script = state.script;
  const glossary = state.glossary;

  const playerDeps = useMemo(
    () => ({
      present: avatar.present,
      interrupt: avatar.interrupt,
      subscribe: avatar.subscribe,
    }),
    [avatar.present, avatar.interrupt, avatar.subscribe],
  );
  const { player } = useScriptPlayer(playerDeps);
  const { session, setPlayerState, setActiveTurn, onControl, onTurn, onPhase, sendPushToTalk } =
    useSession();
  const ptt = usePushToTalk();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState("");
  const [playerState, setLocalPlayerState] = useState<PlayerState>("idle");
  const [holdHelp, setHoldHelp] = useState<HoldHelp | null>(null);
  const [tapHelp, setTapHelp] = useState<TapHelp | null>(null);
  const [started, setStarted] = useState(false);
  /* Phase 3 — adaptive conversation state. */
  const [adaptive, setAdaptive] = useState(false);
  const [userTurnActive, setUserTurnActive] = useState(false);
  const [brainPhase, setBrainPhase] = useState<"idle" | "thinking">("idle");
  const [conversationEnded, setConversationEnded] = useState(false);
  const [conversationError, setConversationError] = useState<string | null>(null);

  useEffect(() => {
    if (script) player.load(script, glossary);
  }, [script, glossary, player]);

  useEffect(() => {
    player.setEvents({
      onSpeakingText: (text) => setSpeakingText(text),
      onTurn: (turn) => {
        setTurns((prev) => [...prev, turn]);
        setActiveTurnId(turn.id);
        setHoldHelp(null);
        setActiveTurn(turn);
      },
      onState: (s) => {
        setLocalPlayerState(s);
        setPlayerState(s);
      },
    });
    return () => {
      player.setEvents({});
      player.interrupt();
      setActiveTurn(null);
      setPlayerState(undefined);
    };
  }, [player, setActiveTurn, setPlayerState]);

  const activeTurn = turns.find((t) => t.id === activeTurnId) ?? null;
  /* The player pauses at user turns (the SDK cannot speak the user's line);
     surface a "your turn" prompt so the practice flow keeps moving. */
  const atUserTurn = activeTurn?.speaker === "user" && playerState === "talking";
  const showUserTurn = userTurnActive || atUserTurn;
  /* Avatar is actually speaking only outside the user-turn / listening /
     thinking windows — covers both scripted turns and generated replies. */
  const isSpeaking =
    playerState === "talking" &&
    !showUserTurn &&
    ptt.state !== "recording" &&
    brainPhase === "idle";

  const handleStart = useCallback(async () => {
    if (!script) return;
    if (!avatar.ready) {
      setError("Presenter is still loading — please wait a moment and try again.");
      return;
    }
    try {
      speakGuide(null);
      await unlockAudio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start audio. Tap Start again.");
      return;
    }
    player.play();
    setStarted(true);
    /* Seed the server orchestrator so push-to-talk works. If this fails, the
       call still runs in scripted mode (Continue advances the script). */
    if (session?.id) {
      setCallContext(session.id, {
        script,
        glossary,
        summary: state.summary,
        answers: state.answers,
        reference: state.reference,
        settings: state.settings,
      }).catch(() => {
        setConversationError("Live conversation is offline — the script will guide the call.");
      });
    }
    /* Persist the scenario (Phase 5c) so the user can restore this call later. */
    if (!state.scenarioId && state.scenario) {
      createScenario({
        sessionId: session?.id,
        summary: state.summary,
        reference: state.reference,
        answers: state.answers,
        settings: state.settings,
        selection: state.scenario,
        script,
        glossary,
      })
        .then(({ id }) => setScenarioId(id))
        .catch(() => {});
    }
  }, [
    script,
    glossary,
    avatar,
    session,
    player,
    setError,
    unlockAudio,
    speakGuide,
    state.summary,
    state.answers,
    state.reference,
    state.settings,
    state.scenario,
    state.scenarioId,
    setScenarioId,
  ]);

  const handleHold = useCallback(async () => {
    const help = await player.hold();
    setHoldHelp(help);
    setTapHelp(null);
  }, [player]);

  const handleResume = useCallback(() => {
    player.resume();
    setHoldHelp(null);
  }, [player]);

  const handleContinue = useCallback(() => {
    player.resume();
  }, [player]);

  const handleTapHelp = useCallback(
    (entryId: string) => {
      const help = player.tapHelp(entryId);
      setTapHelp(help);
    },
    [player],
  );

  /* Companion phones send hold/resume/tap-help over the hub — run them here. */
  useEffect(() => {
    return onControl((msg) => {
      if (msg.action === "hold") void handleHold();
      else if (msg.action === "resume") handleResume();
      else if (msg.action === "tapHelp" && msg.entryId) handleTapHelp(msg.entryId);
    });
  }, [onControl, handleHold, handleResume, handleTapHelp]);

  /* Phase 3 — present a generated bureaucrat reply, then invite the next turn. */
  const presentReply = useCallback(
    async (turn: Turn) => {
      try {
        const options =
          turn.emotion || turn.intensity
            ? { emotion: turn.emotion, intensity: turn.intensity }
            : undefined;
        await avatar.present(turn.jp, options);
      } catch {
        /* the transcript still shows the reply */
      }
      setUserTurnActive(true);
    },
    [avatar],
  );

  /* Phase 3 — the orchestrator broadcasts turns for the whole conversation. */
  useEffect(() => {
    return onTurn((msg) => {
      const turn = msg.turn;
      setTurns((prev) => [...prev, turn]);
      setActiveTurn(turn);
      if (msg.end) {
        setBrainPhase("idle");
        avatar.setThinking(false);
        setConversationEnded(true);
        return;
      }
      if (turn.speaker === "bureaucrat") {
        setBrainPhase("idle");
        avatar.setThinking(false);
        void presentReply(turn);
      }
    });
  }, [onTurn, avatar, setActiveTurn, presentReply]);

  /* Phase 3 — mirror the server's brain phase on the avatar (thinking). */
  useEffect(() => {
    return onPhase((msg) => {
      setBrainPhase(msg.phase);
      avatar.setThinking(msg.phase === "thinking");
    });
  }, [onPhase, avatar]);

  const handlePTTDown = useCallback(async () => {
    if (ptt.state === "recording") return;
    setUserTurnActive(false);
    setConversationError(null);
    const recording = await ptt.start();
    if (recording) {
      avatar.setListening(true);
    } else {
      setUserTurnActive(true);
    }
  }, [ptt, avatar]);

  const handlePTTUp = useCallback(async () => {
    if (ptt.state !== "recording") return;
    avatar.setListening(false);
    const audio = await ptt.stop();
    if (!audio) {
      setUserTurnActive(true);
      return;
    }
    setAdaptive(true);
    setBrainPhase("thinking");
    avatar.setThinking(true);
    try {
      await sendPushToTalk(audio);
    } catch (err) {
      setBrainPhase("idle");
      avatar.setThinking(false);
      setUserTurnActive(true);
      setConversationError(
        err instanceof Error ? err.message : "Could not send your voice — please try again.",
      );
    }
  }, [ptt, avatar, sendPushToTalk]);

  const handleFinish = useCallback(async () => {
    if (!script) return;
    if (!state.cheatSheet) {
      setBusy(true);
      try {
        const sheet = await pipeline.makeCheatSheet(script, glossary, state.answers, state.reference);
        setCheatSheet(sheet);
        /* Attach the cheat sheet to the persisted scenario (Phase 5c). */
        if (state.scenarioId) {
          void updateScenario(state.scenarioId, { cheatSheet: sheet }).catch(() => {});
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to build cheat sheet");
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    toCheatSheet();
    /* Walk the cheat sheet through as Luna (the guide), not the practice role. */
    void (async () => {
      try {
        await avatar.launch({
          avatarId: DEFAULT_AVATAR_ID,
          sceneId: DEFAULT_SCENE_ID,
          voiceId: DEFAULT_VOICE_ID,
        });
      } catch {
        /* keep current avatar if the swap fails */
      }
      speakGuide({ en: "Nice work! Here's your cheat sheet for the real call — keep it handy." });
    })();
  }, [
    script,
    glossary,
    state.answers,
    state.cheatSheet,
    state.reference,
    state.scenarioId,
    setBusy,
    setCheatSheet,
    setError,
    toCheatSheet,
    avatar,
    speakGuide,
  ]);

  const ended = playerState === "ended" || conversationEnded;
  const canStart = !started && !ended && Boolean(script);

  return (
    <div className="relative z-10 flex h-svh flex-col">
      {state.error && (
        <div className="flex items-center justify-between gap-2 border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <span>{state.error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <main className="relative flex-1">
        {canStart && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/30 p-4 backdrop-blur-sm">
            <Button size="lg" onClick={handleStart} className="gap-2 text-base">
              <PhoneCall />
              Start call
            </Button>
          </div>
        )}

        {ended && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/30 p-4 backdrop-blur-sm">
            <p className="text-lg font-semibold text-primary">Call complete</p>
            <Button size="lg" onClick={handleFinish}>
              View cheat sheet
            </Button>
          </div>
        )}

        {showUserTurn && !ended && (
          <div className="absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
            <div className="flex w-[26rem] max-w-full flex-col gap-3 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
              {ptt.state === "recording" ? (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-primary">
                    Listening…
                  </p>
                  <p className="flex items-center gap-2 text-sm text-foreground">
                    <span className="size-2 animate-pulse rounded-full bg-destructive" />
                    Keep holding to speak — release when done.
                  </p>
                </>
              ) : brainPhase === "thinking" ? (
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Loader2 className="size-4 animate-spin text-accent" />
                  The office is thinking…
                </div>
              ) : (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-primary">
                    Your turn
                  </p>
                  {!adaptive && activeTurn?.speaker === "user" && activeTurn.jp && (
                    <p className="text-sm text-foreground">
                      Try: <span className="font-medium">{activeTurn.jp}</span>
                      {activeTurn.en && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{activeTurn.en}</span>
                      )}
                    </p>
                  )}
                  <button
                    type="button"
                    onPointerDown={() => void handlePTTDown()}
                    onPointerUp={() => void handlePTTUp()}
                    onPointerLeave={() => void handlePTTUp()}
                    onPointerCancel={() => void handlePTTUp()}
                    disabled={!ptt.supported}
                    className={cn(
                      "flex select-none touch-none items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/25 active:bg-accent/30",
                      !ptt.supported && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <Mic className="size-4" />
                    Hold to speak
                  </button>
                  {conversationError && (
                    <p className="text-xs text-destructive">{conversationError}</p>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleContinue}
                    className="gap-1 self-end"
                  >
                    Skip & continue <ChevronRight className="size-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {isSpeaking && (
          <div className="pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-accent/25 px-3 py-1 text-xs font-medium">
              <span className="size-2 animate-pulse rounded-full bg-accent" />
              Speaking…
            </span>
            {activeTurn?.emotion && (
              <span className="inline-flex items-center rounded-full border border-accent/40 bg-card/70 px-3 py-1 text-xs font-medium text-foreground backdrop-blur">
                {activeTurn.emotion}
                {activeTurn.intensity ? ` · ${activeTurn.intensity}` : ""}
              </span>
            )}
          </div>
        )}

        <VocabOverlay
          turn={activeTurn}
          glossary={glossary}
          speakingText={speakingText}
          onTapHelp={handleTapHelp}
        />

        <HelpLayer
          holdHelp={holdHelp}
          tapHelp={tapHelp}
          playerState={playerState}
          onHold={handleHold}
          onResume={handleResume}
          onDismissTap={() => setTapHelp(null)}
        />

        <aside className="absolute right-0 top-0 z-20 hidden h-full w-80 flex-col border-l bg-card/70 backdrop-blur md:flex">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <p className="text-sm font-medium text-primary">Transcript</p>
            {isSpeaking && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="size-1.5 animate-pulse rounded-full bg-accent" />
                live
              </span>
            )}
          </div>
          <ScrollArea className="h-[calc(100%-2.5rem)]">
            <Transcript turns={turns} activeTurnId={activeTurnId} />
          </ScrollArea>
        </aside>
      </main>
    </div>
  );
}
