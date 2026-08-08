import { VolumeX } from "lucide-react";
import { useAvatar } from "@/state/avatar-context";
import { AvatarGuide } from "./AvatarGuide";

/** Floating avatar controls, always ABOVE the app screens (z-40, above the
 *  z-10 screens) so the sound toggle and guide bubble are clickable/visible. */
export function AvatarOverlay() {
  const { session, audioUnlocked, unlockAudio } = useAvatar();

  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      {!audioUnlocked && session.ready && (
        <button
          type="button"
          onClick={() => {
            void unlockAudio().catch(() => {
              /* non-trusted gesture (autoplay policy) — user can tap again */
            });
          }}
          className="pointer-events-auto absolute bottom-5 left-5 inline-flex items-center gap-2 rounded-full border bg-card/90 px-4 py-2 text-sm font-medium shadow-lg backdrop-blur transition-colors hover:bg-accent/20"
        >
          <VolumeX className="size-4 text-destructive" />
          Turn sound on
        </button>
      )}
      <AvatarGuide />
    </div>
  );
}
