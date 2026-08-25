import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, ChevronRight, Loader2, Mic, PanelRight, PhoneCall } from "lucide-react";
import type { HoldHelp, PlayerState, TapHelp, Turn } from "@/shared/contract";
import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { useSession } from "@/state/session-context";
import { useScriptPlayer } from "@/hooks/use-script-player";
import { useCallWsEvents } from "@/hooks/use-call-ws-events";
import { useCallMicInput } from "@/hooks/use-call-mic-input";
import type { PushToTalkResult } from "@/hooks/use-push-to-talk";
import { useTalkMode } from "@/state/talk-mode-context";
import { setCallContext } from "@/lib/session-api";
import { createScenario, updateScenario } from "@/lib/scenario-api";
import { TalkModeSelector } from "@/components/app/AppHeader";
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
  const { session, setPlayerState, setActiveTurn, onControl, onTurn, onPhase, sendPushToTalk, run } =
    useSession();
  const { talkMode } = useTalkMode();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState("");
  const [playerState, setLocalPlayerState] = useState<PlayerState>("idle");
  const [holdHelp, setHoldHelp] = useState<HoldHelp | null>(null);
  const [tapHelp, setTapHelp] = useState<TapHelp | null>(null);
  const [started, setStarted] = useState(false);
  /* §7c.2 — the transcript aside is desktop-only (md+); below md this toggle
     slides the same panel in as an overlay so the transcript is reachable on
     phones/tablets instead of invisible. */
  const [transcriptOpen, setTranscriptOpen] = useState(false);
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
  const ended = playerState === "ended" || conversationEnded;

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
        target: state.target,
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
        target: state.target,
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
    state.target,
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

  /* Phase 3 — the orchestrator broadcasts turns for the whole conversation;
     mirror the brain phase (thinking/idle) on the avatar too. Both handlers
     are handed to useCallWsEvents below, alongside the companion `control`
     relays (hold/resume/tapHelp). */
  const handleServerTurn = useCallback(
    (turn: Turn, end: boolean | undefined) => {
      setTurns((prev) => [...prev, turn]);
      setActiveTurn(turn);
      if (end) {
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
    },
    [setActiveTurn, avatar, presentReply],
  );

  const handleServerPhase = useCallback(
    (phase: "idle" | "thinking") => {
      setBrainPhase(phase);
      avatar.setThinking(phase === "thinking");
    },
    [avatar],
  );

  useCallWsEvents({
    onControl,
    onTurn,
    onPhase,
    onHold: () => void handleHold(),
    onResume: handleResume,
    onTapHelp: handleTapHelp,
    onServerTurn: handleServerTurn,
    onServerPhase: handleServerPhase,
  });

  /* Phase 3 — submit a recorded utterance to the orchestrator and show the
     avatar "thinking". Shared by push-to-talk and voice-activated (VAD) paths
     (see useCallMicInput's `onUtterance`). */
  const submitUtterance = useCallback(
    async (audio: PushToTalkResult) => {
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
    },
    [avatar, sendPushToTalk],
  );

  const mic = useCallMicInput({
    talkMode,
    // The user's turn is showing and the call hasn't ended — mic input is
    // available at all (also gates the Space-bar hotkey).
    active: showUserTurn && !ended,
    // Further gates the VAD auto-listen window: the call has started and the
    // brain isn't already replying.
    vadReady: started && brainPhase === "idle",
    setListening: avatar.setListening,
    setUserTurnActive,
    setConversationError,
    onUtterance: submitUtterance,
  });

  /* Avatar is actually speaking only outside the user-turn / listening /
     thinking windows — covers both scripted turns and generated replies. */
  const isSpeaking =
    playerState === "talking" &&
    !showUserTurn &&
    mic.ptt.state !== "recording" &&
    brainPhase === "idle";

  const canStart = !started && !ended && Boolean(script);
  const vadFallback = mic.vadFallback;

  /* Phase 7b slice 7 — the run's speculative cheatSheet node (server/graph.mjs)
     delivered while the user rehearses: adopt it and attach it to the
     persisted scenario so Finish navigates instantly. Once per runId — the
     snapshot re-broadcasts on every job change. A null sheet (failed node) is
     ignored without consuming the runId, and Finish's own generation stays as
     the fallback for runs that never deliver one. */
  const appliedSheetRunRef = useRef<string | null>(null);
  useEffect(() => {
    const result = run?.result;
    if (!run || !result || appliedSheetRunRef.current === run.runId) return;
    if (!result.cheatSheet) return;
    appliedSheetRunRef.current = run.runId;
    setCheatSheet(result.cheatSheet);
    /* Attach the cheat sheet to the persisted scenario (Phase 5c). */
    if (state.scenarioId) {
      void updateScenario(state.scenarioId, { cheatSheet: result.cheatSheet }).catch(() => {});
    }
  }, [run, state.scenarioId, setCheatSheet]);

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
            <div className="flex w-full max-w-[26rem] flex-col gap-3 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
              {brainPhase === "thinking" ? (
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <Loader2 className="size-4 animate-spin text-accent" />
                  The office is thinking…
                </div>
              ) : talkMode === "vad" && !vadFallback ? (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-primary">
                    Your turn
                  </p>
                  {mic.vad.state === "listening" ? (
                    <p className="flex items-center gap-2 text-sm text-foreground">
                      <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
                      Listening — speak whenever you're ready.
                    </p>
                  ) : mic.vad.state === "speaking" ? (
                    <p className="flex items-center gap-2 text-sm text-foreground">
                      <span className="size-2 animate-pulse rounded-full bg-destructive" />
                      I can hear you — go ahead.
                    </p>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-foreground">
                      <Loader2 className="size-4 animate-spin text-accent" />
                      Starting microphone…
                    </p>
                  )}
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <AudioLines className="size-3.5" />
                    Voice-activated — no button needed.
                  </p>
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
              ) : mic.ptt.state === "recording" ? (
                <>
                  <p className="text-xs font-medium uppercase tracking-wide text-primary">
                    Listening…
                  </p>
                  <p className="flex items-center gap-2 text-sm text-foreground">
                    <span className="size-2 animate-pulse rounded-full bg-destructive" />
                    {mic.micLatched
                      ? "Recording hands-free — click the mic or press Space to send."
                      : "Keep holding to speak — release when done."}
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-primary">
                      Your turn
                    </p>
                    {/* §7c.5 — talk mode on the primary surface, right where
                        it takes effect (switching live re-evaluates the VAD
                        window). */}
                    <TalkModeSelector compact />
                  </div>
                  {!adaptive && activeTurn?.speaker === "user" && activeTurn.jp && (
                    <p className="text-sm text-foreground">
                      Try: <span className="font-medium">{activeTurn.jp}</span>
                      {activeTurn.en && (
                        <span className="ml-1.5 text-xs text-muted-foreground">{activeTurn.en}</span>
                      )}
                    </p>
                  )}
                  {mic.vad.state === "error" && mic.vad.error && (
                    <p className="text-xs text-destructive">
                      {mic.vad.error} Falling back to the hold button.
                    </p>
                  )}
                  <button
                    type="button"
                    onPointerDown={() => mic.handleMicPress()}
                    onPointerUp={() => mic.handleMicRelease()}
                    onPointerLeave={() => mic.handleMicRelease()}
                    onPointerCancel={() => mic.handleMicRelease()}
                    disabled={!mic.ptt.supported}
                    className={cn(
                      "flex select-none touch-none items-center justify-center gap-2 rounded-lg border border-accent/40 bg-accent/15 px-4 py-3 text-sm font-semibold text-accent transition-colors hover:bg-accent/25 active:bg-accent/30",
                      !mic.ptt.supported && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <Mic className="size-4" />
                    {mic.micLatched ? "Click or press Space to send" : "Hold to speak"}
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

        <Button
          variant="outline"
          size="icon"
          onClick={() => setTranscriptOpen((open) => !open)}
          aria-expanded={transcriptOpen}
          aria-label="Toggle transcript"
          title="Transcript"
          className="absolute right-3 top-3 z-30 bg-card/70 backdrop-blur md:hidden"
        >
          <PanelRight className="size-4" />
        </Button>

        <aside
          className={cn(
            "absolute right-0 top-0 z-20 h-full w-80 max-w-full flex-col border-l bg-card/80 backdrop-blur md:flex",
            transcriptOpen ? "flex" : "hidden",
          )}
        >
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
