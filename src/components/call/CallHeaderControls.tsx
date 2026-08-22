import { useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { PRACTICE_AVATAR_ID } from "@/lib/presets";
import { MotionBrowser } from "@/components/stage/MotionBrowser";
import { DeviceBadge } from "@/components/session/SessionBar";
import { Button } from "@/components/ui/button";

/** Call-screen header controls (device badge + mute + motion browser +
 *  end/restart), rendered into the persistent AppHeader while a call is
 *  active. */
export function CallHeaderControls() {
  const { state, reset } = useAppStore();
  const { session: avatar } = useAvatar();
  /* §7c.5 — `muteAudio` existed with no caller; this is its control. Mutes the
     practice partner's speaker output locally (the conversation continues). */
  const [muted, setMuted] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <DeviceBadge />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => {
          const next = !muted;
          setMuted(next);
          avatar.muteAudio(next);
        }}
        aria-pressed={muted}
        aria-label={muted ? "Unmute Luna's voice" : "Mute Luna's voice"}
        title={muted ? "Unmute" : "Mute"}
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </Button>
      <MotionBrowser
        avatarId={state.scenario?.avatarId ?? PRACTICE_AVATAR_ID}
        onPlay={(motionId) => void avatar.playMotion(motionId)}
      />
      <Button variant="ghost" size="sm" onClick={reset}>
        End & restart
      </Button>
    </div>
  );
}
