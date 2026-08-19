import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { cn } from "@/lib/utils";

/** Speech bubble from Luna (the guide). On the setup screen it sits just above
 *  her portrait card (bottom-left); during calls it falls back to the bottom.
 *  The `md:max-w` keeps it clear of the right-hand setup panel. */
export function AvatarGuide() {
  const { guide, session } = useAvatar();
  const { state } = useAppStore();
  if (!guide) return null;
  const isCall = state.screen === "call";

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 flex justify-center px-4 sm:justify-start sm:pl-6 md:max-w-[calc(100vw-28rem)] lg:justify-start lg:pl-8",
        isCall ? "bottom-6" : "bottom-[444px]",
      )}
    >
      <div className="pointer-events-auto flex max-w-xl items-start gap-2.5 rounded-2xl rounded-bl-sm border border-border bg-card/95 px-5 py-3.5 shadow-xl backdrop-blur">
        <span
          className={`mt-1 size-2 shrink-0 rounded-full ${
            session.isSpeaking ? "animate-pulse bg-accent" : "bg-primary/40"
          }`}
        />
        <p className="text-sm leading-relaxed text-foreground">{guide.en}</p>
      </div>
    </div>
  );
}
