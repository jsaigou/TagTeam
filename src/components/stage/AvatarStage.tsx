import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { Button } from "@/components/ui/button";
import {
  AVATAR_WINDOW_RIGHT,
  AVATAR_WINDOW_SIZE,
  AVATAR_WINDOW_TOP,
} from "@/lib/avatar-window";
import { cn } from "@/lib/utils";

/** The assistant: a square, rounded portrait window pinned to the TOP-RIGHT
 *  corner just below the app header (all breakpoints), expanding to a
 *  full-screen presenter during the practice call (there the avatar IS the
 *  practice partner). The Get Started hero (setup screen, panel closed) is
 *  avatar-free — the stage is invisible there but keeps preloading; the door
 *  intro then covers this exact rect, so when its facade fades there is no
 *  repositioning jump. Geometry lives in src/lib/avatar-window.ts.
 *
 *  Card centering calibration (QA round): the SDK has no camera pan, and the
 *  guide avatar's render anchors at ~22.8% of the canvas width (measured
 *  2026-08-08 against a full-screen window), so in the square card she reads
 *  pushed left. The card shifts the canvas right by 27.2% so her anchor lands
 *  mid-card, with a cover scale of ~1.545 (= 1 + 2 × 0.272) so scene pixels
 *  still fill the card after the shift; expect a mild vertical crop. The shift
 *  is percentage-based, so it survives the corner placement unchanged. If the
 *  guide avatar or default scene changes, re-measure and retune the two
 *  arbitrary values below together: translate-x = (50 − anchor)%,
 *  scale = 1 + 2 × translate/100. */
export function AvatarStage() {
  const { stageRef, session } = useAvatar();
  const { state } = useAppStore();
  const isCall = state.screen === "call";
  /* QA round: the Get Started hero is avatar-free. The stage stays mounted
     (the presenter keeps preloading) but nothing renders visibly — the door
     intro covers her window instead, hiding the loading pill behind doors. */
  const isInvite =
    state.screen === "setup" && !state.setupOpen && state.introPhase === "idle";
  const windowStyle = {
    top: AVATAR_WINDOW_TOP,
    right: AVATAR_WINDOW_RIGHT,
    width: AVATAR_WINDOW_SIZE,
    height: AVATAR_WINDOW_SIZE,
  };

  return (
    <div
      className={cn(
        "fixed inset-0 z-0",
        /* opacity-0 alongside invisible: the presenter's render surface can
           override inherited visibility once active — opacity cannot be
           overridden from inside the subtree. */
        isInvite && "invisible opacity-0 pointer-events-none",
      )}
    >
      <div
        ref={stageRef}
        className={cn(
          "relative overflow-hidden bg-card",
          isCall
            ? "h-full w-full"
            : "absolute rounded-2xl border border-border shadow-2xl [&>sv-presenter]:h-full [&>sv-presenter]:w-full [&>sv-presenter]:translate-x-[27.2%] [&>sv-presenter]:scale-[1.545]",
        )}
        style={isCall ? undefined : windowStyle}
      />

      {!session.ready && (
        /* Mirror the window's box so the pill/retry sits ON the card (and
           behind the intro doors while those run). */
        <div
          className="pointer-events-none absolute flex items-center justify-center"
          style={isCall ? { inset: 0 } : windowStyle}
        >
          {session.loadError ? (
            <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-xl border bg-card/90 p-6 text-center shadow-lg">
              <p className="text-sm text-destructive">Could not load the presenter.</p>
              <Button size="sm" variant="outline" onClick={session.retryLoad}>
                Retry
              </Button>
            </div>
          ) : (
            <p className="rounded-full border bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-lg">
              Waking Luna up…
            </p>
          )}
        </div>
      )}
    </div>
  );
}
