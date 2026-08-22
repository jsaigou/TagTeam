import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The assistant: a framed portrait card on the setup/cheat-sheet screens,
 *  expanding to a full-screen presenter during the practice call (there the
 *  avatar IS the practice partner). The scene (anime backdrop) is the avatar's
 *  background; the widget re-fits itself to the container via its internal
 *  ResizeObserver.
 *
 *  Non-call placement — Luna assists, she is not the star. Desktop (md+): the
 *  card sits LEFT and vertically centered (`md:pl-8`, `md:size-[min(36vmin,17rem)]`)
 *  while the screens reserve that lane and take the dominant share. Below md:
 *  a small top-anchored card (`pt-40`, `size-36`) with content stacked under it.
 *  The Get Started hero (setup screen, panel closed) is avatar-free — the stage
 *  is invisible there but keeps preloading. Keep these numbers in sync with
 *  AvatarGuide's bubble anchor and the screens'
 *  `pl-[calc(3.5rem+min(36vmin,17rem))]` / `pt-[21rem]` reservations. */
export function AvatarStage() {
  const { stageRef, session } = useAvatar();
  const { state } = useAppStore();
  const isCall = state.screen === "call";
  /* QA round: the Get Started hero is avatar-free. The stage stays mounted
     (the presenter keeps preloading) but nothing renders visibly. */
  const isInvite = state.screen === "setup" && !state.setupOpen;

  return (
    <div className={cn("fixed inset-0 z-0", isInvite && "invisible")}>
      <div
        className={cn(
          "h-full w-full",
          !isCall &&
            "flex items-start justify-center pt-40 md:items-center md:justify-start md:pl-8 md:pt-0",
        )}
      >
        <div
          ref={stageRef}
          className={cn(
            "relative overflow-hidden bg-card",
            isCall
              ? "h-full w-full"
              : "size-36 rounded-2xl border border-border shadow-2xl md:size-[min(36vmin,17rem)]",
          )}
        />
      </div>

      {!session.ready && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 flex",
            isCall
              ? "items-center justify-center"
              : "items-start justify-center pt-40 md:items-center md:justify-start md:pl-8 md:pt-0",
          )}
        >
          {/* Mirror the card's box so the pill/retry sits ON the card. */}
          <div
            className={cn(
              "flex items-center justify-center",
              !isCall && "size-36 md:size-[min(36vmin,17rem)]",
            )}
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
        </div>
      )}
    </div>
  );
}
