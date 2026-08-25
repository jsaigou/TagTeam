/**
 * The prep (briefing) screen between research delivery and the practice call.
 *
 * Opens as an MGS-briefing PASTICHE: a CRT overlay (scanlines, phosphor tint,
 * flicker, roll bar) over the whole viewport — Luna included, reframed by
 * AvatarStage into a half-size top-left "monitor" — while a low male voice
 * delivers the transmission line. The three key terms then land one by one
 * with a detection cue (deliberately unspoken), Luna coughs, the CRT effect
 * lifts, and she explains each term in her own voice before asking if the
 * user is ready to advance to the call.
 *
 * All sounds are original WebAudio/speech-synthesis synthesizations (see
 * briefing-audio.ts); subtitles carry every spoken line so the flow works
 * with sound blocked. Skip jumps straight to the ready state.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, FastForward } from "lucide-react";
import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { Button } from "@/components/ui/button";
import { packToSelection } from "@/lib/presets";
import { DEFAULT_AVATAR_ID, DEFAULT_SCENE_ID, DEFAULT_VOICE_ID } from "@/lib/presets";
import { pickKeyTerms } from "@/lib/key-terms";
import { resumeBriefingAudio } from "@/lib/briefing-audio";
import { BRIEFING_LINE, usePrepBriefing } from "@/hooks/use-prep-briefing";
import { cn } from "@/lib/utils";

export function PrepScreen() {
  const { state, toCall } = useAppStore();
  const { session } = useAvatar();
  const terms = useMemo(
    () => pickKeyTerms(state.glossary, state.script),
    [state.glossary, state.script],
  );
  const { phase, revealed, activeIndex, subtitle, skip } = usePrepBriefing(
    terms,
    session.speak,
  );
  /** The Metal Gear layer ends with the cough. */
  const crtOn = phase === "briefing" || phase === "listing" || phase === "cough";

  /* QA fix — the presenter was showing the PRACTICE avatar (SetupScreen used
     to launch it before navigating here). The briefing belongs to Luna: swap
     to the guide preset on mount; her own stage pill/retry handles failures.
     The practice avatar is launched at the ready-click instead (once per
     mount — StrictMode-safe via a ref). */
  const lunaLaunchedRef = useRef(false);
  const [handoff, setHandoff] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  useEffect(() => {
    if (lunaLaunchedRef.current) return;
    lunaLaunchedRef.current = true;
    void session
      .launch({ avatarId: DEFAULT_AVATAR_ID, sceneId: DEFAULT_SCENE_ID, voiceId: DEFAULT_VOICE_ID })
      .catch(() => {});
    // Once per mount; `session` identity churns with provider renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReady = () => {
    const selection = state.scenario ?? packToSelection(state.settings.role);
    if (!selection) {
      setHandoff({ busy: false, error: "That call is missing its avatar setup." });
      return;
    }
    setHandoff({ busy: true, error: null });
    void session
      .launch(selection)
      .then(() => toCall())
      .catch((err: unknown) =>
        setHandoff({
          busy: false,
          error: err instanceof Error ? err.message : "Failed to launch the presenter.",
        }),
      );
  };

  return (
    <div
      className="relative min-h-svh"
      onPointerDown={() => resumeBriefingAudio()}
    >
      {/* One-off keyframes; scoped here because only the briefing uses them. */}
      <style>{`
        @keyframes crt-flicker {
          0% { opacity: 0.92; }
          50% { opacity: 1; }
          100% { opacity: 0.95; }
        }
        @keyframes crt-roll {
          0% { transform: translateY(-20vh); }
          100% { transform: translateY(120vh); }
        }
        @keyframes bullet-in {
          0% { opacity: 0; transform: translateX(-14px); }
          100% { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div className="mx-auto flex w-full max-w-2xl flex-col justify-center gap-6 px-4 pb-24 pt-[calc(3.75rem_+_min(18vmin,6.5rem)_+_1.5rem)] sm:pt-16">
        <div>
          <p
            className={cn(
              "font-mono text-xs font-bold tracking-[0.3em] text-muted-foreground uppercase transition-colors",
              crtOn && "text-emerald-500",
            )}
          >
            {crtOn ? "// TRANSMISSION" : "// MISSION BRIEFING"}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            Before you dial: 3 keys for this call
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {state.script?.scenarioTitle ?? ""}
          </p>
        </div>

        {/* Subtitle strip — carries the transmission line and the cough. */}
        <div
          className={cn(
            "min-h-10 rounded-lg border px-4 py-2 font-mono text-sm transition-opacity",
            subtitle ? "opacity-100" : "opacity-0",
            crtOn ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-300" : "text-muted-foreground",
          )}
        >
          <span className="me-2 text-emerald-500">▸</span>
          {subtitle ?? BRIEFING_LINE}
        </div>

        <ol className="flex flex-col gap-3">
          {terms.map((t, i) => {
            const shown = i < revealed;
            const active = i === activeIndex;
            return (
              <li
                key={t.id}
                style={shown ? { animation: "bullet-in 240ms ease-out" } : undefined}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4 transition-all",
                  shown ? "opacity-100" : "opacity-25",
                  active
                    ? "border-primary bg-primary/5 shadow-md"
                    : "bg-card",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-sm font-bold",
                    shown && crtOn
                      ? "border-emerald-600 bg-emerald-900/60 text-emerald-300"
                      : "border-border bg-muted text-foreground",
                  )}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-lg leading-snug font-semibold">
                    {t.kanji}
                    <span className="ms-2 text-base font-normal text-muted-foreground">
                      {t.furigana}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">{t.en}</p>
                  {t.note && (
                    <p className="mt-1 text-xs text-muted-foreground/80 italic">{t.note}</p>
                  )}
                </div>
                {active && (
                  <span className="ms-auto mt-1 flex items-center gap-1 text-xs text-primary">
                    <AlertTriangle className="size-3 animate-pulse" />
                    listening
                  </span>
                )}
              </li>
            );
          })}
        </ol>

        <div className="flex items-center justify-end gap-3 pt-2">
          {phase !== "ready" ? (
            <Button variant="ghost" onClick={skip} className="gap-2">
              <FastForward className="size-4" />
              Skip briefing
            </Button>
          ) : (
            <>
              {handoff.error && (
                <p className="text-sm text-destructive">{handoff.error}</p>
              )}
              <span className="text-sm text-muted-foreground">Ready to practice?</span>
              <Button
                size="lg"
                onClick={handleReady}
                disabled={handoff.busy}
                className="gap-2 rounded-full px-8 shadow-lg"
              >
                <Check className="size-5" />
                {handoff.busy ? "Warming up the practice avatar…" : "I'm ready — start the call"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* The CRT layer: scanlines + phosphor tint + flicker + roll bar +
          vignette, over EVERYTHING on this screen including Luna's monitor.
          pointer-events-none so the UI beneath stays usable. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed inset-0 z-30 transition-opacity duration-700",
          crtOn ? "opacity-100" : "opacity-0",
        )}
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.45) 100%)",
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              "repeating-linear-gradient(to bottom, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)",
            animation: crtOn ? "crt-flicker 180ms steps(2) infinite" : undefined,
          }}
        />
        <div
          className="absolute inset-0 mix-blend-screen"
          style={{ background: "linear-gradient(rgba(16,185,129,0.07), rgba(16,185,129,0.03))" }}
        />
        <div
          className="absolute inset-x-0 h-24"
          style={{
            background:
              "linear-gradient(to bottom, transparent, rgba(190,255,220,0.06), transparent)",
            animation: crtOn ? "crt-roll 7s linear infinite" : undefined,
          }}
        />
      </div>
    </div>
  );
}
