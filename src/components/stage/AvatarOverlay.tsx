import { AvatarGuide } from "./AvatarGuide";

/** Floating avatar UI, always ABOVE the app screens (z-40, above the z-10
 *  screens) so the guide bubble is visible. Audio needs no toggle — speech is
 *  triggered by real user gestures (Get started / Start call). */
export function AvatarOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-40">
      <AvatarGuide />
    </div>
  );
}
