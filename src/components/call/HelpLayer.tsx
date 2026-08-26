import { PauseCircle, Play, X } from "lucide-react";
import type { HoldHelp, TapHelp } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type HelpLayerProps = {
  holdHelp: HoldHelp | null;
  tapHelp: TapHelp | null;
  playerState: "idle" | "talking" | "held" | "ended";
  onHold: () => void;
  onResume: () => void;
  onDismissTap: () => void;
};

export function HelpLayer({
  holdHelp,
  tapHelp,
  playerState,
  onHold,
  onResume,
  onDismissTap,
}: HelpLayerProps) {
  const busy = playerState === "talking";

  return (
    <>
      {tapHelp && (
        <div className="absolute right-4 top-16 z-30 w-72 rounded-xl border bg-popover p-4 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-primary">Quick help</p>
            <button
              type="button"
              onClick={onDismissTap}
              className="rounded p-1 text-muted-foreground hover:bg-accent/30"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{tapHelp.hint}</p>
        </div>
      )}

      {holdHelp ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-md rounded-xl border border-destructive/40 bg-card p-6 shadow-lg">
            <div className="flex items-center gap-2 text-destructive">
              <PauseCircle className="size-5" />
              <h3 className="text-base font-semibold">Call held: explanation</h3>
            </div>
            <p className="mt-2 text-sm leading-relaxed">{holdHelp.explanationEn}</p>
            <div className="mt-4 flex justify-end">
              <Button onClick={onResume} variant="destructive" size="lg">
                <Play />
                Resume call
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onHold}
          disabled={!busy}
          className={cn(
            "absolute bottom-16 right-4 z-30 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition-colors",
            busy
              ? "border-border bg-card text-foreground hover:bg-accent/30"
              : "border-border bg-card/60 text-muted-foreground",
          )}
        >
          <PauseCircle className="size-4 text-destructive" />
          Hold & explain
        </button>
      )}
    </>
  );
}
