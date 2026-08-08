import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, PhoneCall, Sparkles } from "lucide-react";
import type { HoldHelp, PlayerState, TapHelp, Turn } from "@/shared/contract";
import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { useScriptPlayer } from "@/hooks/use-script-player";
import { pipeline } from "@/state/pipeline";
import { Transcript } from "./Transcript";
import { VocabOverlay } from "./VocabOverlay";
import { HelpLayer } from "./HelpLayer";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

export function CallScreen() {
  const {
    state,
    toCheatSheet,
    setCheatSheet,
    setBusy,
    setError,
    reset,
  } = useAppStore();
  const { session, unlockAudio, speakGuide } = useAvatar();
  const script = state.script;
  const glossary = state.glossary;

  const playerDeps = useMemo(
    () => ({
      present: session.present,
      interrupt: session.interrupt,
      subscribe: session.subscribe,
    }),
    [session.present, session.interrupt, session.subscribe],
  );
  const { player } = useScriptPlayer(playerDeps);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [speakingText, setSpeakingText] = useState("");
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [holdHelp, setHoldHelp] = useState<HoldHelp | null>(null);
  const [tapHelp, setTapHelp] = useState<TapHelp | null>(null);
  const [started, setStarted] = useState(false);

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
      },
      onState: (s) => setPlayerState(s),
    });
    return () => {
      player.setEvents({});
      player.interrupt();
    };
  }, [player]);

  const activeTurn = turns.find((t) => t.id === activeTurnId) ?? null;
  const isSpeaking = playerState === "talking";
  /* The player pauses at user turns (the SDK cannot speak the user's line);
     surface a "your turn" prompt so the practice flow keeps moving. */
  const atUserTurn = activeTurn?.speaker === "user" && playerState === "talking";

  const handleStart = useCallback(async () => {
    if (!script) return;
    if (!session.ready) {
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
  }, [script, session, player, setError, unlockAudio, speakGuide]);

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

  const handleFinish = useCallback(async () => {
    if (!script) return;
    /* Reuse a pre-seeded cheat sheet (demo path) rather than re-generating. */
    if (state.cheatSheet) {
      toCheatSheet();
      return;
    }
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
    <div className="relative z-10 flex h-svh flex-col">
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

        {atUserTurn && (
          <div className="absolute inset-x-0 bottom-24 z-30 flex justify-center px-4">
            <div className="flex max-w-md flex-col gap-2 rounded-xl border bg-card/95 p-4 shadow-lg backdrop-blur">
              <p className="text-xs font-medium uppercase tracking-wide text-primary">
                Your turn
              </p>
              <p className="text-sm text-foreground">{activeTurn?.jp}</p>
              {activeTurn?.en && <p className="text-xs text-muted-foreground">{activeTurn.en}</p>}
              <Button size="sm" onClick={handleContinue} className="gap-1 self-end">
                Continue <ChevronRight className="size-4" />
              </Button>
            </div>
          </div>
        )}

        {isSpeaking && (
          <div className="pointer-events-none absolute left-4 top-4 z-20">
            <span className="inline-flex items-center gap-2 rounded-full bg-accent/25 px-3 py-1 text-xs font-medium">
              <span className="size-2 animate-pulse rounded-full bg-accent" />
              Speaking…
            </span>
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
