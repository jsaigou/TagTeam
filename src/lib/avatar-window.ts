/** Luna's home window — a square, rounded portrait card pinned to the
 *  top-right corner just below the app header. Single source of truth shared
 *  by AvatarStage (card placement), DoorsIntro (the reveal overlay covers this
 *  exact rect, so the doors dissolve onto her with no repositioning jump),
 *  AvatarGuide (bubble anchor) and the screens' narrow-viewport paddings.
 *
 *  Plain CSS length strings so consumers drop them into inline styles or
 *  calc(). Tailwind arbitrary classes that mirror these values (e.g. content
 *  `pt-[calc(...)]`) must be kept in sync by hand — see CONTENT_CLEARANCE. */

export const AVATAR_WINDOW_SIZE = "min(36vmin, 13rem)";
export const AVATAR_WINDOW_TOP = "3.75rem";
export const AVATAR_WINDOW_RIGHT = "1.25rem";
/** Matches Tailwind's `rounded-2xl`. */
export const AVATAR_WINDOW_RADIUS = "1rem";

/** Content top padding below xl: clears the corner window plus breathing room. */
export const CONTENT_CLEARANCE = `calc(${AVATAR_WINDOW_TOP} + ${AVATAR_WINDOW_SIZE} + 1.5rem)`;

/** Setup-panel geometry: the wide main card starts high enough that only the
 *  bottom-left of Luna's window clips its top-right corner (the card runs
 *  under her by this much). The header row inside the card keeps clear of her
 *  footprint with PANEL_HEADER_CLEAR. */
export const PANEL_OVERLAP = "2.5rem";
export const PANEL_TOP = `calc(${AVATAR_WINDOW_TOP} + ${AVATAR_WINDOW_SIZE} - ${PANEL_OVERLAP})`;
export const PANEL_HEADER_CLEAR = `calc(${AVATAR_WINDOW_RIGHT} + ${AVATAR_WINDOW_SIZE})`;
