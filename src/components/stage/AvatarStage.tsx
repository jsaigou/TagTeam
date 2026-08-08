import { VolumeX } from "lucide-react";
import { useAvatar } from "@/state/avatar-context";
import { useAppStore } from "@/state/app-store";
import { getBackgroundUrl } from "@/lib/backgrounds";
import { AvatarGuide } from "./AvatarGuide";
import { Button } from "@/components/ui/button";

/** The star: the avatar lives in a small framed window over a full-screen
 *  static background, so the background art is actually visible. */
export function AvatarStage() {
  const { stageRef, session, audioUnlocked, unlockAudio } = useAvatar();
  const { state } = useAppStore();

  return (
    <div className="fixed inset-0 z-0">
      {/* Static scenario background, full screen. */}
      <img
        src={getBackgroundUrl(state.background)}
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Small avatar window — just big enough for the avatar, framed. Meeks
          anchors ~23% across the presenter view, so the window is positioned to
          place that anchor at screen center. */}
      <div
        className="absolute h-[min(72vh,620px)] w-[min(420px,44vw)]"
        style={{
          left: "calc(50% - 0.228 * min(420px, 44vw))",
          top: "calc(50% - 0.595 * min(72vh, 620px))",
        }}
      >
        <div
          ref={stageRef}
          className="h-full w-full overflow-hidden rounded-[1.5rem] border-2 border-white/95 shadow-[0_18px_45px_-12px_rgba(15,35,15,0.55)]"
        />

        {!session.ready && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {session.loadError ? (
              <div className="pointer-events-auto flex flex-col items-center gap-2 rounded-xl border bg-card/90 p-4 text-center shadow-lg">
                <p className="text-sm text-destructive">Could not load the presenter.</p>
                <Button size="sm" variant="outline" onClick={session.retryLoad}>
                  Retry
                </Button>
              </div>
            ) : (
              <p className="rounded-full border bg-card/90 px-4 py-2 text-sm text-muted-foreground shadow-lg">
                Waking Meeks up…
              </p>
            )}
          </div>
        )}
      </div>

      {!audioUnlocked && session.ready && (
        <button
          type="button"
          onClick={() => {
            void unlockAudio().catch(() => {
              /* non-trusted gesture (autoplay policy) — user can tap again */
            });
          }}
          className="absolute bottom-5 left-5 z-30 inline-flex items-center gap-2 rounded-full border bg-card/90 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur transition-colors hover:bg-accent/20"
        >
          <VolumeX className="size-4 text-destructive" />
          Turn sound on
        </button>
      )}

      <AvatarGuide />
    </div>
  );
}
