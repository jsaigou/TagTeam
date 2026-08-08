import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCall, Sparkles } from "lucide-react";
import type { HoldHelp, PlayerState, TapHelp, Turn } from "@/shared/contract";
import { useAppStore } from "@/state/app-store";
import { useAvatarSession, useScriptPlayer } from "@/state/connect";
import { pipeline } from "@/state/pipeline";
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
    reset,
  } = useAppStore();
  const script = state.script;
  const glossary = state.glossary;
  const scenario = state.scenario;

  const session = useAvatarSession();
  const player = useScriptPlayer({ speak: (text) => session.speak(text) });

  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState("");
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [holdHelp, setHoldHelp] = useState<HoldHelp | null>(null);
  const [tapHelp, setTapHelp] = useState<TapHelp | null>(null);
  const [started, setStarted] = useState(false);
  /* Integration point (connect-core owns it): the real <sv-presenter> element mounts
     inside this div. Keep it visible — do NOT add overflow-hidden to the stage itself,
     or the presenter (and its floating co-pilot overlays) can be clipped. */
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scenario) session.launch(scenario.avatarId, scenario.sceneId, scenario.voiceId);
    if (script) player.load(script, glossary);
  }, [script, glossary, scenario, session, player]);

  useEffect(() => {
    player.setEvents({
      onSpeakingText: (text) => setSpeakingText(text),
      onTurn: (turn) => {
        setTurns((prev) => [...prev, turn]);
        setActiveTurnId(turn.id);
        setHoldHelp(null);
      },
      onState: (s) => setPlayerState(s),
    });
    return () => {
      player.setEvents({});
      player.interrupt();
    };
  }, [player]);

  /* TODO(stub): connect-core owns the presenter events. At integration, replace
     this listener with the real CONNECT_TOKEN_EXPIRED wiring from src/lib/presenter.ts;
     it currently just surfaces a session-expired error into the store. */
  useEffect(() => {
    const onTokenExpired = () => setError("Session expired — please sign in again.");
    window.addEventListener("CONNECT_TOKEN_EXPIRED", onTokenExpired);
    return () => window.removeEventListener("CONNECT_TOKEN_EXPIRED", onTokenExpired);
  }, [setError]);

  const activeTurn = turns.find((t) => t.id === activeTurnId) ?? null;

  const handleStart = useCallback(async () => {
    if (!script) return;
    try {
      await session.resumeAudio();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start audio. Tap Start again.");
      return;
    }
    player.play();
    setStarted(true);
  }, [script, session, player, setError]);

  const handleHold = useCallback(async () => {
    const help = await player.hold();
    setHoldHelp(help);
    setTapHelp(null);
  }, [player]);

  const handleResume = useCallback(() => {
    player.resume();
    setHoldHelp(null);
  }, [player]);

  const handleTapHelp = useCallback(
    (entryId: string) => {
      const help = player.tapHelp(entryId);
      setTapHelp(help);
    },
    [player],
  );

  const handleFinish = useCallback(async () => {
    if (!script) return;
    setBusy(true);
    try {
      const sheet = await pipeline.makeCheatSheet(script, glossary, state.answers);
      setCheatSheet(sheet);
      toCheatSheet();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build cheat sheet");
    } finally {
      setBusy(false);
    }
  }, [script, glossary, state.answers, setBusy, setCheatSheet, setError, toCheatSheet]);

  const ended = playerState === "ended";
  const canStart = !started && !ended && Boolean(script);

  return (
    <div className="flex h-svh flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b bg-card px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          <span className="text-sm font-medium">{script?.scenarioTitle ?? "Call"}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={reset}>
          End & restart
        </Button>
      </header>

      {state.error && (
        <div className="flex items-center justify-between gap-2 border-b border-destructive/40 bg-destructive/5 px-4 py-2 text-sm text-destructive">
          <span>{state.error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError(null)}>
            Dismiss
          </Button>
        </div>
      )}

      <main className="grid flex-1 grid-cols-1 gap-0 overflow-hidden md:grid-cols-[1fr_320px]">
        <section className="relative flex min-h-0 flex-col bg-gradient-to-br from-background to-accent/20">
          <div
            ref={stageRef}
            className="relative flex flex-1 items-center justify-center overflow-hidden p-4"
          >
            {scenario ? (
              <div className="flex flex-col items-center gap-4 text-center">
                <div
                  className={cn(
                    "flex size-56 items-center justify-center rounded-full border-4 border-accent bg-card shadow-xl transition-transform",
                    session.isSpeaking && "scale-[1.02] animate-pulse",
                  )}
                >
                  <span className="text-7xl">🎧</span>
                </div>
                <div>
                  <p className="text-lg font-semibold text-primary">{scenario.avatarId}</p>
                  <p className="text-sm text-muted-foreground">{scenario.sceneId}</p>
                </div>
                {session.isSpeaking && (
                  <p className="inline-flex items-center gap-2 rounded-full bg-accent/25 px-3 py-1 text-xs font-medium">
                    <span className="size-2 animate-pulse rounded-full bg-accent" />
                    Speaking…
                  </p>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">Scenario not ready.</p>
            )}
          </div>

          <VocabOverlay
            turn={activeTurn}
            glossary={glossary}
            speakingText={speakingText}
            onTapHelp={handleTapHelp}
          />

          {canStart && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/40 p-4 backdrop-blur-sm">
              <Button size="lg" onClick={handleStart} className="gap-2 text-base">
                <PhoneCall />
                Start call
              </Button>
            </div>
          )}

          {ended && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/40 p-4 backdrop-blur-sm">
              <p className="text-lg font-semibold text-primary">Call complete</p>
              <Button size="lg" onClick={handleFinish}>
                View cheat sheet
              </Button>
            </div>
          )}

          <HelpLayer
            holdHelp={holdHelp}
            tapHelp={tapHelp}
            playerState={playerState}
            onHold={handleHold}
            onResume={handleResume}
            onDismissTap={() => setTapHelp(null)}
          />
        </section>

        <aside className="hidden min-h-0 border-l bg-card/40 md:block">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <p className="text-sm font-medium text-primary">Transcript</p>
            {playerState === "talking" && (
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
