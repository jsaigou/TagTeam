import { useAvatar } from "@/state/avatar-context";

/** Speech bubble from the star avatar, anchored near it at the bottom. */
export function AvatarGuide() {
  const { guide, session } = useAvatar();
  if (!guide) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4">
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
