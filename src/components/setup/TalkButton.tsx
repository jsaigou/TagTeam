import { Loader2, Mic } from "lucide-react";
import type { GuideChatState } from "@/hooks/use-guide-chat";
import { cn } from "@/lib/utils";

/** The Talk button: tap once and just speak — a voice-activated (VAD) mic
 *  session opens, detects when you pause, and submits on its own. Tap again
 *  to stop. Active mode glows so it's obvious the mic is live. */
export function TalkButton({
  state,
  supported,
  onStart,
  onStop,
}: {
  state: GuideChatState;
  supported: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const thinking = state === "thinking";
  const listening = state === "listening";
  const disabled = !supported || thinking;
  /* Active talk mode reads as a live, glowing control — bigger text plus a
     soft accent glow on both the button and its label. */
  const glow = listening
    ? {
        boxShadow:
          "0 0 18px 2px color-mix(in srgb, var(--accent) 55%, transparent), 0 0 4px 1px color-mix(in srgb, var(--accent) 40%, transparent)",
      }
    : undefined;
  const labelGlow = listening
    ? { textShadow: "0 0 10px color-mix(in srgb, var(--accent) 80%, transparent)" }
    : undefined;
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        if (state === "listening") {
          onStop();
        } else {
          onStart();
        }
      }}
      disabled={disabled}
      title={
        !supported
          ? "Microphone unavailable"
          : listening
            ? "Listening. Tap to stop"
            : "Tap, then just speak"
      }
      style={glow}
      className={cn(
        "flex select-none items-center justify-center gap-2 rounded-lg border font-semibold transition-all",
        listening ? "px-5 py-3 text-base sm:text-lg" : "px-4 py-2.5 text-sm",
        listening
          ? "border-accent/60 bg-accent/20 text-accent"
          : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {thinking ? (
        <Loader2 className="size-4 animate-spin" />
      ) : listening ? (
        <span className="size-3 animate-pulse rounded-full bg-destructive" />
      ) : (
        <Mic className="size-4" />
      )}
      <span style={labelGlow}>
        {listening ? "Listening…" : thinking ? "Luna is thinking…" : "Talk"}
      </span>
    </button>
  );
}
