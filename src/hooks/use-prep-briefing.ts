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

  /* Identity-proofing (QA fix): `speak` gets a fresh function identity
     whenever the avatar provider re-renders — and every speak() toggles its
     isSpeaking state, re-rendering the provider MID-SEQUENCE. Keying the
     effect on that identity made it tear down and restart in a loop,
     replaying the briefing line forever. The sequence therefore reads both
     inputs through refs and runs EXACTLY ONCE per mount; a started guard
     keeps even a hot effect re-run from replaying the line. */
  const termsRef = useRef(terms);
  const speakRef = useRef(speak);
  useEffect(() => {
    termsRef.current = terms;
    speakRef.current = speak;
  });

  /** Invalidate the current run token; called from skip() and unmount. */
  const invalidate = useCallback(() => {
    runIdRef.current++;
    cancelBriefingSpeech();
  }, []);

  useEffect(() => {
    // [invalidate] is stable → this runs once per mount; the refs above keep
    // mid-sequence provider re-renders from ever restarting it.
    const runId = ++runIdRef.current;
    const alive = () => runIdRef.current === runId;
    const guard = <T,>(p: Promise<T>, fallback: T): Promise<T> =>
      p.catch(() => fallback);

    void (async () => {
      try {
        resumeBriefingAudio();
        setPhase("briefing");
        setSubtitle(BRIEFING_LINE);
        await guard(speakBriefingLine(BRIEFING_LINE), false);
        if (!alive()) return;

        setPhase("listing");
        const current = termsRef.current;
        for (let i = 0; i < current.length; i++) {
          playDetectionCue();
          setRevealed(i + 1);
          await new Promise((r) => window.setTimeout(r, REVEAL_MS));
          if (!alive()) return;
        }

        setPhase("cough");
        setSubtitle(COUGH_SUBTITLE);
        playCough();
        await new Promise((r) => window.setTimeout(r, COUGH_MS));
        if (!alive()) return;
        setSubtitle(null);

        setPhase("explain");
        for (let i = 0; i < current.length; i++) {
          setActiveIndex(i);
          const t = current[i];
          await guard(speakRef.current(`${t.furigana}. This means: ${t.en}.`), undefined);
          if (!alive()) return;
        }
        setActiveIndex(-1);
        await guard(speakRef.current("Are you ready?"), undefined);
        if (!alive()) return;
        setPhase("ready");
      } catch {
        if (alive()) setPhase("ready");
      }
    })();

    return invalidate;
  }, [invalidate]);

  const skip = useCallback(() => {
    runIdRef.current++;
    cancelBriefingSpeech();
    setSubtitle(null);
    setRevealed(terms.length);
    setActiveIndex(-1);
    setPhase("ready");
  }, [terms.length]);

  return { phase, revealed, activeIndex, subtitle, skip };
}
