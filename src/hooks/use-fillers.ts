import { useEffect, useRef } from "react";
import { FILLER_INTERVAL_MS, FILLER_JITTER_MS, pickFiller, type FillerLang } from "@/lib/fillers";

export type UseFillersOpts = {
  active: boolean;
  lang?: FillerLang;
  enabled?: boolean;
  speak: (text: string) => void;
  isSpeaking: () => boolean;
};

/**
 * Speak vocalized fillers on a jittered interval while `active` (a background
 * worker LLM is searching/fetching/parsing). Skips a tick if the avatar is
 * already speaking; remembers the last filler so the same string never
 * repeats back-to-back.
 */
export function useFillers(opts: UseFillersOpts): void {
  const { active, enabled = true, lang } = opts;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const lastRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!active || !enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const schedule = () => {
      timer = setTimeout(fire, FILLER_INTERVAL_MS + Math.random() * FILLER_JITTER_MS);
    };

    const fire = () => {
      if (cancelled) return;
      const current = optsRef.current;
      if (!current.active || current.enabled === false) return;
      if (!current.isSpeaking()) {
        const filler = pickFiller(current.lang ?? "en", lastRef.current);
        lastRef.current = filler;
        current.speak(filler);
      }
      schedule();
    };

    schedule();

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
      lastRef.current = undefined;
    };
  }, [active, enabled, lang]);
}
