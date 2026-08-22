import { useMemo } from "react";

import { buildTimeline } from "@/lib/karaoke";
import { useSpeechKaraoke } from "@/hooks/use-speech-karaoke";
import { cn } from "@/lib/utils";

/** Word-by-word karaoke reveal for a line Luna is speaking right now.
 *  Renders plain text when the line isn't the active utterance (or speech
 *  finished), so displayed text always matches what was said. */
export function KaraokeText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const speech = useSpeechKaraoke();
  const words = useMemo(() => buildTimeline(text).words, [text]);
  const live = speech && !speech.done && speech.text === text && words.length > 0;

  if (!live) return <span className={className}>{text}</span>;

  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={i}>
          {w.pre}
          <span
            className={cn(
              "transition-colors duration-150",
              i < speech.index
                ? undefined
                : i === speech.index
                  ? "font-medium text-accent"
                  : "text-muted-foreground/50",
            )}
          >
            {w.text}
          </span>
        </span>
      ))}
    </span>
  );
}
