import { useEffect, useState } from "react";
import {
  fallbackAvatarWindowRect,
  getAvatarWindowRect,
  watchAvatarWindow,
  type WindowRect,
} from "@/lib/avatar-window";

/** Luna's window rect, live: re-measured whenever the registered anchor
 *  (the setup panel) moves/resizes, the page scrolls, or the viewport
 *  changes. Falls back to the fixed viewport corner with no anchor. */
export function useAvatarWindowRect(): WindowRect {
  const [rect, setRect] = useState<WindowRect>(fallbackAvatarWindowRect);
  useEffect(() => watchAvatarWindow(() => setRect(getAvatarWindowRect())), []);
  return rect;
}
