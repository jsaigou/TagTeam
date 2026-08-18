import { useAvatar } from "@/state/avatar-context";

/** Speech bubble from Luna (the guide), anchored near her at the bottom. On
 *  wide screens it stays left of the setup panel so it never covers the
 *  phone-pairing controls. */
export function AvatarGuide() {
  const { guide, session } = useAvatar();
  if (!guide) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-4 sm:justify-start sm:pl-6 md:max-w-[calc(100vw-28rem)] lg:justify-start lg:pl-8">
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
