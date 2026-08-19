import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The star: a framed portrait card on the setup/cheat-sheet screens, expanding
 *  to a full-screen presenter during the practice call. The scene (anime
 *  backdrop) is the avatar's background; the widget re-fits itself to the
 *  container via its internal ResizeObserver. */
export function AvatarStage() {
  const { stageRef, session } = useAvatar();
  const { state } = useAppStore();
  const isCall = state.screen === "call";

  return (
    <div className="fixed inset-0 z-0">
      <div className={cn("h-full w-full", !isCall && "flex items-center justify-center p-4")}>
        <div
          ref={stageRef}
          className={cn(
            "relative overflow-hidden bg-card",
            isCall
              ? "h-full w-full"
              : "size-[min(60vmin,24rem)] rounded-2xl border border-border shadow-2xl",
          )}
        />
      </div>

      {!session.ready && (
        <div
          className={cn(
            "pointer-events-none absolute flex items-center justify-center",
            isCall ? "inset-0" : "inset-0",
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
      )}
    </div>
  );
}
