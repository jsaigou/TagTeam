/**
 * Prep-screen briefing sequence (the Metal-Gear-pastiche opening):
 *
 *   briefing → listing → cough → explain → ready
 *
 * 1. `briefing` — the low-male transmission line over the CRT overlay.
 * 2. `listing`  — the three key terms appear ONE BY ONE with a detection
 *                 cue each, deliberately NOT spoken.
 * 3. `cough`    — Luna coughs; the CRT/Metal Gear effect ends here and the
 *                 component drops the overlay.
 * 4. `explain`  — back to her own voice: she says and explains each term,
 *                 then asks if the user is ready.
 * 5. `ready`    — the advance-to-practice CTA unlocks.
 *
 * Every step is skippable (`skip`) and fully unwound on unmount. Speech
 * failures never strand the flow — they resolve and move on (subtitles carry
 * the content).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GlossaryEntry } from "@/shared/contract";
import {
  cancelBriefingSpeech,
  playCough,
  playDetectionCue,
  resumeBriefingAudio,
  speakBriefingLine,
} from "@/lib/briefing-audio";

export const BRIEFING_LINE = "Big Boss has infiltrated the base... it's up to you...";
const COUGH_SUBTITLE = "*koff koff*";
/** Per-bullet reveal beat (cue + read time). */
const REVEAL_MS = 950;
/** How long the cough moment holds before the CRT effect lifts. */
const COUGH_MS = 1300;

export type BriefingPhase = "briefing" | "listing" | "cough" | "explain" | "ready";

export function usePrepBriefing(terms: GlossaryEntry[], speak: (text: string) => Promise<void>) {
  const [phase, setPhase] = useState<BriefingPhase>("briefing");
  const [revealed, setRevealed] = useState(0);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [subtitle, setSubtitle] = useState<string | null>(BRIEFING_LINE);
  /** Monotonic token: skip()/unmount invalidates every in-flight await. */
  const runIdRef = useRef(0);

  const sleep = (ms: number) =>
    new Promise<boolean>((resolve) => {
      const id = window.setTimeout(() => resolve(true), ms);
      // Resolves false only via the timeout being cleared on teardown —
      // handled implicitly: after unmount setState calls are skipped by the
      // runId guard, so a leaked timer resolving late is harmless.
      void id;
    });

  const run = useCallback(async () => {
    const runId = ++runIdRef.current;
    const alive = () => runIdRef.current === runId;
    const guard = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch(() => fallback);

    try {
      resumeBriefingAudio();
      setPhase("briefing");
      setSubtitle(BRIEFING_LINE);
      await guard(speakBriefingLine(BRIEFING_LINE), false);
      if (!alive()) return;

      setPhase("listing");
      for (let i = 0; i < terms.length; i++) {
        playDetectionCue();
        setRevealed(i + 1);
        await sleep(REVEAL_MS);
        if (!alive()) return;
      }

      setPhase("cough");
      setSubtitle(COUGH_SUBTITLE);
      playCough();
      await sleep(COUGH_MS);
      if (!alive()) return;
      setSubtitle(null);

      setPhase("explain");
      for (let i = 0; i < terms.length; i++) {
        setActiveIndex(i);
        const t = terms[i];
        await guard(
          speak(`${t.furigana}. This means: ${t.en}.`),
          undefined,
        );
        if (!alive()) return;
      }
      setActiveIndex(-1);
      await guard(speak("Are you ready?"), undefined);
      if (!alive()) return;
      setPhase("ready");
    } catch {
      if (alive()) setPhase("ready");
    }
  }, [terms, speak]);

  /** Invalidate the current run token; called from skip() and unmount. */
  const invalidate = useCallback(() => {
    runIdRef.current++;
    cancelBriefingSpeech();
  }, []);

  useEffect(() => {
    void run();
    return invalidate;
  }, [run, invalidate]);

  const skip = useCallback(() => {
    invalidate();
    setSubtitle(null);
    setRevealed(terms.length);
    setActiveIndex(-1);
    setPhase("ready");
  }, [invalidate, terms.length]);

  return { phase, revealed, activeIndex, subtitle, skip };
}
