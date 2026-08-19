import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatEntry = {
  role: "luna" | "user";
  text: string;
};

/** Persistent transcript of the setup-screen conversation with Luna. Unlike the
 *  transient comic bubble, entries here never disappear. */
export function ChatBox({ messages }: { messages: ChatEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="flex max-h-56 min-h-24 items-center justify-center rounded-xl border border-dashed bg-muted/30 px-4 py-6 text-center text-xs text-muted-foreground">
        Ask Luna anything about your call — she replies here and in the speech
        bubble.
      </div>
    );
  }

  return (
    <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-xl border bg-muted/30 p-3">
      {messages.map((m, i) => (
        <div
          key={i}
          className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
        >
          <div
            className={cn(
              "flex max-w-[85%] items-start gap-2 rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
              m.role === "user"
                ? "rounded-br-sm bg-primary text-primary-foreground"
                : "rounded-bl-sm border border-border bg-card",
            )}
          >
            {m.role === "luna" && (
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
            )}
            <span>{m.text}</span>
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
