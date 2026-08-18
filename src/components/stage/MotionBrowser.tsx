import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, Sparkles } from "lucide-react";
import { getAvatarMotions, type MotionAsset } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type MotionBrowserProps = {
  avatarId: string;
  avatarName?: string;
  /** Runs the selected motion on the live avatar (playMotion). */
  onPlay: (motionId: string) => void;
  disabled?: boolean;
};

/** Phase 4 — showcase: enumerate the current avatar's motion catalog and preview
 *  any motion on the live avatar. Motions are per-avatar, so the catalog is
 *  fetched lazily for the practice avatar when the browser opens. */
export function MotionBrowser({ avatarId, avatarName, onPlay, disabled = false }: MotionBrowserProps) {
  const [open, setOpen] = useState(false);
  const [motions, setMotions] = useState<MotionAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await getAvatarMotions(avatarId);
      setMotions(page.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the motion catalog.");
    } finally {
      setLoading(false);
    }
  }, [avatarId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handlePlay = useCallback(
    (motionId: string) => {
      onPlay(motionId);
      setPlayingId(motionId);
      window.setTimeout(() => setPlayingId((id) => (id === motionId ? null : id)), 2500);
    },
    [onPlay],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} className="gap-1.5">
          <Sparkles className="size-3.5" />
          Motions
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Motion catalog</DialogTitle>
          <DialogDescription>
            {avatarName ? `${avatarName}'s gestures — ` : ""}tap a motion to preview it on the
            avatar. Motions are specific to each avatar.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading motions…
          </div>
        )}

        {!loading && error && (
          <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {!loading && !error && motions && (
          <ScrollArea className="max-h-[50vh]">
            {motions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No motions available for this avatar.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {motions.map((motion) => (
                  <button
                    key={motion.id}
                    type="button"
                    onClick={() => handlePlay(motion.id)}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      playingId === motion.id
                        ? "border-accent bg-accent/20"
                        : "border-border bg-card hover:bg-accent/20",
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{motion.name}</span>
                      {motion.tags && motion.tags.length > 0 && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {motion.tags.join(" · ")}
                        </span>
                      )}
                    </span>
                    {playingId === motion.id ? (
                      <Play className="size-4 shrink-0 animate-pulse text-accent" />
                    ) : (
                      <Play className="size-4 shrink-0 text-muted-foreground" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
