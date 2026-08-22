import { useSyncExternalStore } from "react";

import {
  KaraokeTracker,
  stripMotionMarkup,
  type SpeechView,
} from "@/lib/karaoke";
import type { PresenterEventName, PresenterEventHandler } from "./use-presenter";

/** Module-singleton karaoke engine (one presenter element per app).
 *
 *  Deliberately NOT React state on the avatar session: the reveal advances
 *  every animation frame while Luna speaks, and only the handful of surfaces
 *  that render spoken text (chat bubbles, guide bubble, transcript) subscribe
 *  via useSyncExternalStore — the rest of the tree never re-renders.
 */

let view: SpeechView | null = null;
const listeners = new Set<() => void>();
const tracker = new KaraokeTracker();
let raf = 0;
let currentId = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function setView(next: SpeechView | null): void {
  if (
    next === view ||
    (next &&
      view &&
      next.id === view.id &&
      next.index === view.index &&
      next.frac === view.frac &&
      next.done === view.done)
  ) {
    return;
  }
  view = next;
  emit();
}

function tick(): void {
  raf = 0;
  const p = tracker.progress(performance.now());
  setView({
    id: currentId,
    text: tracker.getText(),
    index: p.index,
    frac: p.frac,
    done: p.done,
  });
  if (!p.done) raf = requestAnimationFrame(tick);
}

/** Begin tracking an utterance about to be presented. */
export function beginSpeech(content: string): void {
  const clean = stripMotionMarkup(content);
  if (!clean) return;
  tracker.start(clean, performance.now());
  currentId += 1;
  if (raf) cancelAnimationFrame(raf);
  setView({ id: currentId, text: clean, index: 0, frac: 0, done: false });
  raf = requestAnimationFrame(tick);
}

/** Hard-stop (interrupt) — freeze whatever is revealed. */
export function endSpeech(): void {
  tracker.finish();
}

type WireDeps = {
  subscribe: (
    event: PresenterEventName,
    handler: PresenterEventHandler,
  ) => () => void;
};

let unwire: (() => void) | null = null;

/** Attach the engine to the presenter's events. Idempotent — a new wiring
 *  replaces the previous one (StrictMode double-mounts). */
export function wireSpeechKaraoke(deps: WireDeps): void {
  unwire?.();
  const offChunk = deps.subscribe("PLAYING_SPEECH_TEXT", (event) => {
    const { text } = (event as CustomEvent<{ text?: string }>).detail ?? {};
    tracker.onChunk(text ?? "", performance.now());
  });
  const offEnd = deps.subscribe("PERFORMANCE_END", () => {
    // The pump publishes done on its next frame; nothing else needed here.
    tracker.finish();
  });
  unwire = () => {
    offChunk();
    offEnd();
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** Subscribe a component to the live karaoke view. */
export function useSpeechKaraoke(): SpeechView | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => view,
  );
}
