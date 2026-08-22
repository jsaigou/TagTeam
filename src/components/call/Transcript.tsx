import { useEffect, useRef } from "react";
import { User } from "lucide-react";
import type { Turn } from "@/shared/contract";
import { KaraokeText } from "@/components/KaraokeText";
import { cn } from "@/lib/utils";

type TranscriptProps = {
  turns: Turn[];
  activeTurnId: string | null;
};

export function Transcript({ turns, activeTurnId }: TranscriptProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  if (turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        The call transcript will appear here as it happens.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {turns.map((turn) => {
        const isUser = turn.speaker === "user";
        const active = turn.id === activeTurnId;
        return (
          <div
            key={turn.id}
            className={cn(
              "flex flex-col gap-1 rounded-lg border p-3 transition-colors",
              active ? "border-accent bg-accent/15" : "border-border bg-card",
              isUser && "ml-8",
              !isUser && "mr-8",
            )}
          >
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <User className={cn("size-3.5", isUser ? "text-primary" : "text-accent")} />
              {isUser ? "You" : "Bureaucrat"}
              {!isUser && turn.emotion && (
                <span className="rounded-full border border-accent/40 px-1.5 py-px text-[10px] font-medium text-accent">
                  {turn.emotion}
                  {turn.intensity ? ` · ${turn.intensity}` : ""}
                </span>
              )}
            </div>
            {/* Karaoke reveal while the bureaucrat is speaking this line. */}
            <KaraokeText text={turn.jp} className="text-sm leading-relaxed" />
            {turn.en && <p className="text-xs text-muted-foreground">{turn.en}</p>}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
