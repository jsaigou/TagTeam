import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { PRACTICE_AVATAR_ID } from "@/lib/presets";
import { MotionBrowser } from "@/components/stage/MotionBrowser";
import { DeviceBadge } from "@/components/session/SessionBar";
import { Button } from "@/components/ui/button";

/** Call-screen header controls (device badge + motion browser + end/restart),
 *  rendered into the persistent AppHeader while a call is active. */
export function CallHeaderControls() {
  const { state, reset } = useAppStore();
  const { session: avatar } = useAvatar();

  return (
    <div className="flex items-center gap-2">
      <DeviceBadge />
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
