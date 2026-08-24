/** Luna's home window — a square, rounded portrait card ATTACHED TO THE SETUP
 *  PANEL: she floats in front of the "Getting ready for your call" card and
 *  clips its top-right corner (a constant PANEL_OVERLAP of her footprint dips
 *  below the card's top edge and sticks out past its right edge). Single
 *  source of truth shared by AvatarStage (card placement), DoorsIntro (the
 *  reveal overlay covers this exact rect) and the setup panel (PANEL_TOP /
 *  PANEL_HEADER_CLEAR).
 *
 *  Plain CSS length strings so consumers drop them into inline styles or
 *  calc(). Tailwind arbitrary classes that mirror these values (e.g. content
 *  `pt-[calc(...)]`) must be kept in sync by hand — see CONTENT_CLEARANCE. */

export const AVATAR_WINDOW_SIZE = "min(36vmin, 13rem)";
export const AVATAR_WINDOW_TOP = "3.75rem";
/** The setup card is `max-w-[80%]` centered inside a `px-4` container
 *  (SetupScreen), so its right edge sits exactly 10vw from the viewport edge.
 *  Anchoring Luna to `10vw - PANEL_OVERLAP` keeps a constant 2.5rem of her
 *  sticking out past the card's right edge at any viewport width (clamped
 *  near the viewport edge when 10vw gets small). Keep the 10vw in sync with
 *  the panel's max-width. */
export const AVATAR_WINDOW_RIGHT = "max(0.75rem, calc(10vw - 2.5rem))";
/** Matches Tailwind's `rounded-2xl`. */
export const AVATAR_WINDOW_RADIUS = "1rem";

/** Content top padding below xl: clears the corner window plus breathing room. */
export const CONTENT_CLEARANCE = `calc(${AVATAR_WINDOW_TOP} + ${AVATAR_WINDOW_SIZE} + 1.5rem)`;

/** Setup-panel geometry: the wide main card starts high enough that only the
 *  bottom-left of Luna's window clips its top-right corner (the card runs
 *  under her by this much; AVATAR_WINDOW_RIGHT mirrors the same amount
 *  horizontally). The header row inside the card keeps clear of her footprint
 *  with PANEL_HEADER_CLEAR. */
export const PANEL_OVERLAP = "2.5rem";
export const PANEL_TOP = `calc(${AVATAR_WINDOW_TOP} + ${AVATAR_WINDOW_SIZE} - ${PANEL_OVERLAP})`;
export const PANEL_HEADER_CLEAR = `calc(${AVATAR_WINDOW_RIGHT} + ${AVATAR_WINDOW_SIZE})`;
