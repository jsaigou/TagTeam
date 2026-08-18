import { useAvatar } from "@/state/avatar-context";
import { Button } from "@/components/ui/button";

/** The star: a full-screen, always-present presenter behind every screen. The
 *  scene (anime backdrop) is the avatar's background. */
export function AvatarStage() {
  const { stageRef, session } = useAvatar();

  return (
    <div className="fixed inset-0 z-0">
      <div ref={stageRef} className="h-full w-full" />

      {!session.ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
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
