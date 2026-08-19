import { useEffect } from "react";
import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { cn } from "@/lib/utils";

/** Reading time for a guide line — comic bubbles linger ~55ms per character,
 *  clamped so short prompts are still legible and long ones don't hog the UI. */
function readingTime(text: string): number {
  return Math.min(8000, Math.max(2500, text.length * 55));
}

/** A comic-style speech bubble from Luna (the guide). It pops in near her
 *  portrait, auto-dismisses after a readable interval, and is purely transient
 *  — the persistent copy lives in the setup-screen chat transcript. */
export function AvatarGuide() {
  const { guide, session, clearGuide } = useAvatar();
  const { state } = useAppStore();
  const isCall = state.screen === "call";

  /* Auto-dismiss after a reading-time delay; restart on every new line. */
  useEffect(() => {
    if (!guide) return;
    const t = window.setTimeout(clearGuide, readingTime(guide.en));
    return () => window.clearTimeout(t);
  }, [guide, clearGuide]);

  if (!guide) return null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-20 flex justify-center px-4",
        isCall
          ? "inset-x-0 bottom-6"
          : "left-1/2 top-1/2 -translate-x-1/2 -translate-y-[calc(50%+min(30vmin,12rem)+1.5rem)]",
      )}
    >
      <div className="pointer-events-auto relative flex max-w-md items-start gap-2.5 rounded-2xl rounded-bl-sm border border-border bg-card/95 px-5 py-3.5 shadow-xl backdrop-blur">
        <span
          className={cn(
            "mt-1 size-2 shrink-0 rounded-full",
            session.isSpeaking ? "animate-pulse bg-accent" : "bg-primary/40",
          )}
        />
        <p className="text-sm leading-relaxed text-foreground">{guide.en}</p>
        {/* Comic tail pointing down at Luna. */}
        <span
          className={cn(
            "absolute left-8 h-0 w-0 border-x-8 border-t-8 border-x-transparent",
            isCall ? "-bottom-2" : "-bottom-2",
            "border-t-card/95",
          )}
        />
      </div>
    </div>
  );
}
