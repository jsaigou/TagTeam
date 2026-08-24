/** Luna's home window — a square, rounded portrait card ATTACHED TO THE SETUP
 *  PANEL ELEMENT: she floats IN FRONT of the "Getting ready for your call"
 *  card and clips its top-right corner (a constant PANEL_OVERLAP of her
 *  footprint sticks out past the card's right edge AND dips below its top
 *  edge). SetupScreen registers the card element via setAvatarAnchor(); the
 *  rect is then MEASURED from the live DOM (ResizeObserver + scroll + resize),
 *  so she tracks the panel through reflows instead of floating at fixed
 *  viewport coordinates.
 *
 *  Consumers: AvatarStage (card placement), DoorsIntro + SearchPapersOverlay
 *  (overlays cover her exact rect). When no anchor is registered (non-setup
 *  screens) the measured position falls back to the fixed corner constants.
 */

export const AVATAR_WINDOW_VMIN = 0.36;
export const AVATAR_WINDOW_MAX_REM = 13;
export const AVATAR_WINDOW_TOP_REM = 3.75;
/** Minimum viewport-edge gap for the no-anchor fallback. */
export const AVATAR_VIEWPORT_GAP_REM = 0.75;
export const PANEL_OVERLAP_REM = 2.5;

export const AVATAR_WINDOW_SIZE =
  `min(${AVATAR_WINDOW_VMIN * 100}vmin, ${AVATAR_WINDOW_MAX_REM}rem)`;
export const AVATAR_WINDOW_TOP = `${AVATAR_WINDOW_TOP_REM}rem`;
export const AVATAR_WINDOW_RIGHT =
  `max(${AVATAR_VIEWPORT_GAP_REM}rem, calc(10vw - ${PANEL_OVERLAP_REM}rem))`;
/** Matches Tailwind's `rounded-2xl`. */
export const AVATAR_WINDOW_RADIUS = "1rem";

/** Content top padding below xl: clears the corner window plus breathing room. */
export const CONTENT_CLEARANCE =
  `calc(${AVATAR_WINDOW_TOP} + ${AVATAR_WINDOW_SIZE} + 1.5rem)`;

/** The wide setup card starts high enough that only Luna's bottom-left clips
 *  its top-right corner (the card runs under her by PANEL_OVERLAP). */
export const PANEL_TOP =
  `calc(${AVATAR_WINDOW_TOP} + ${AVATAR_WINDOW_SIZE} - ${PANEL_OVERLAP_REM}rem)`;
/** Header row inside the card keeps clear of her horizontal footprint: she
 *  reaches SIZE − PANEL_OVERLAP into the card from its right edge, plus a
 *  breathing margin. */
export const PANEL_HEADER_CLEAR =
  `calc(${AVATAR_WINDOW_SIZE} - ${PANEL_OVERLAP_REM}rem + 1.25rem)`;

/* --- Live attachment ----------------------------------------------------- */

export interface WindowRect {
  top: number;
  left: number;
  size: number;
}

let anchor: HTMLElement | null = null;
const listeners = new Set<() => void>();
let observer: ResizeObserver | null = null;

function emit(): void {
  for (const listen of listeners) listen();
}

/** Register the element Luna attaches to (the setup panel card); pass null to
 *  detach and fall back to the fixed corner. */
export function setAvatarAnchor(el: HTMLElement | null): void {
  if (anchor === el) return;
  anchor = el;
  observer?.disconnect();
  observer = null;
  if (el && typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(emit);
    observer.observe(el);
  }
  emit();
}

export function getAvatarAnchor(): HTMLElement | null {
  return anchor;
}

const remPx = (): number =>
  parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

export function avatarWindowSizePx(): number {
  return Math.min(
    Math.min(window.innerWidth, window.innerHeight) * AVATAR_WINDOW_VMIN,
    AVATAR_WINDOW_MAX_REM * remPx(),
  );
}

/** No-anchor fallback: the fixed viewport corner (matches AVATAR_WINDOW_TOP /
 *  AVATAR_WINDOW_RIGHT). */
export function fallbackAvatarWindowRect(): WindowRect {
  const rem = remPx();
  const gap = Math.max(
    AVATAR_VIEWPORT_GAP_REM * rem,
    window.innerWidth * 0.1 - PANEL_OVERLAP_REM * rem,
  );
  return {
    size: avatarWindowSizePx(),
    top: AVATAR_WINDOW_TOP_REM * rem,
    left: window.innerWidth - gap - avatarWindowSizePx(),
  };
}

/** Luna's window rect. With an anchor: a constant PANEL_OVERLAP of her hangs
 *  past the anchor's RIGHT edge and dips below its TOP edge — in front of the
 *  panel, clipping its top-right corner — clamped inside the viewport. */
export function getAvatarWindowRect(): WindowRect {
  const s = avatarWindowSizePx();
  if (!anchor || !anchor.isConnected) return fallbackAvatarWindowRect();
  const r = anchor.getBoundingClientRect();
  const overlap = PANEL_OVERLAP_REM * remPx();
  const left = Math.min(
    Math.max(r.right + overlap - s, remPx()),
    window.innerWidth - s - remPx(),
  );
  const top = Math.max(r.top + overlap - s, remPx());
  return { top, left, size: s };
}

/** Subscribe to everything that can move/resize the anchor (anchor swaps,
 *  ResizeObserver on the element itself, window resize, any scroller). Fires
 *  immediately. Returns an unsubscribe function. */
export function watchAvatarWindow(cb: () => void): () => void {
  listeners.add(cb);
  cb();
  window.addEventListener("resize", cb);
  window.addEventListener("scroll", cb, true);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("resize", cb);
    window.removeEventListener("scroll", cb, true);
  };
}
