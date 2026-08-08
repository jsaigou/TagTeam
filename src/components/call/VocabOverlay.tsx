import { Info } from "lucide-react";
import type { GlossaryEntry, Turn } from "@/shared/contract";
import { cn } from "@/lib/utils";

type VocabOverlayProps = {
  turn: Turn | null;
  glossary: GlossaryEntry[];
  speakingText: string;
  onTapHelp: (entryId: string) => void;
};

export function VocabOverlay({ turn, glossary, speakingText, onTapHelp }: VocabOverlayProps) {
  if (!turn) return null;

  const entries = turn.vocab
    .map((id) => glossary.find((g) => g.id === id))
    .filter((g): g is GlossaryEntry => Boolean(g));

  if (entries.length === 0) return null;

  const live = (entry: GlossaryEntry) =>
    speakingText.length > 0 &&
    (speakingText.includes(entry.kanji) || speakingText.includes(entry.furigana));

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-3">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-4">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onTapHelp(entry.id)}
            title="Tap for help"
            className={cn(
              "flex items-baseline gap-4 rounded-full border px-8 py-5 text-6xl shadow-sm transition-all",
              live(entry)
                ? "border-accent bg-accent/30 text-foreground"
                : "border-border bg-card/95 text-foreground",
              "hover:ring-2 hover:ring-ring",
            )}
          >
            <span className="text-7xl font-semibold">{entry.kanji}</span>
            <span className="text-muted-foreground">{entry.furigana}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{entry.en}</span>
            <Info className="ml-1 size-[60px] self-center text-primary" />
          </button>
        ))}
      </div>
    </div>
  );
}
