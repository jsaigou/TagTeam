import { useEffect, type ReactNode } from "react";
import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import {
  AVATAR_WINDOW_RIGHT,
  AVATAR_WINDOW_SIZE,
  AVATAR_WINDOW_TOP,
} from "@/lib/avatar-window";
import { KaraokeText } from "@/components/KaraokeText";
import { cn } from "@/lib/utils";

/** Reading time for a guide line — comic bubbles linger ~55ms per character,
 *  clamped so short prompts are still legible and long ones don't hog the UI. */
function readingTime(text: string): number {
  return Math.min(8000, Math.max(2500, text.length * 55));
}

/** The comic bubble body — placement-specific tail handled by the caller. */
function Bubble({
  children,
  tail,
  speaking,
}: {
  children: ReactNode;
  tail: "up" | "right";
  speaking: boolean;
}) {
  return (
    <div className="pointer-events-auto relative flex max-w-sm items-start gap-2.5 rounded-2xl rounded-bl-sm border border-border bg-card/95 px-5 py-3.5 shadow-xl backdrop-blur">
      <span
        className={cn(
          "mt-1 size-2 shrink-0 rounded-full",
          speaking ? "animate-pulse bg-accent" : "bg-primary/40",
        )}
      />
      {children}
      {/* Comic tail pointing at Luna. */}
      <span
        className={cn(
          "absolute h-0 w-0",
          tail === "right"
            ? "-right-2 top-1/2 -translate-y-1/2 border-y-8 border-l-8 border-y-transparent border-l-card/95"
            : "-top-2 right-10 border-x-8 border-b-8 border-x-transparent border-b-card/95",
        )}
      />
    </div>
  );
}

/** A comic-style speech bubble from Luna (the guide). It pops in beside her
 *  corner window, auto-dismisses after a readable interval, and is purely
 *  transient — the persistent copy lives in the setup-screen chat transcript.
 *  Anchoring mirrors AvatarStage's card: desktop (md+) floats the bubble LEFT
 *  of the top-right window (tail pointing right at her); below md it sits
 *  just under the window (tail pointing up). */
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

  if (isCall) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
        <Bubble tail="up" speaking={session.isSpeaking}>
          <KaraokeText text={guide.en} className="text-sm leading-relaxed text-foreground" />
        </Bubble>
      </div>
    );
  }

  return (
    <>
      {/* md+: left of the corner window, vertically centered on it. */}
      <div
        className="pointer-events-none absolute z-20 hidden md:block"
        style={{
          top: `calc(${AVATAR_WINDOW_TOP} + (${AVATAR_WINDOW_SIZE}) / 2)`,
          right: `calc(${AVATAR_WINDOW_RIGHT} + ${AVATAR_WINDOW_SIZE} + 0.75rem)`,
          transform: "translateY(-50%)",
        }}
      >
        <Bubble tail="right" speaking={session.isSpeaking}>
          <KaraokeText text={guide.en} className="text-sm leading-relaxed text-foreground" />
        </Bubble>
      </div>
      {/* Below md: tucked under the window, hugging the right edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 z-20 flex justify-end pr-3 md:hidden"
        style={{ top: `calc(${AVATAR_WINDOW_TOP} + ${AVATAR_WINDOW_SIZE} + 0.5rem)` }}
      >
        <Bubble tail="up" speaking={session.isSpeaking}>
          <KaraokeText text={guide.en} className="text-sm leading-relaxed text-foreground" />
        </Bubble>
      </div>
    </>
  );
}
