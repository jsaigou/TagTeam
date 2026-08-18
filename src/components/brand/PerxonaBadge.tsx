import { cn } from "@/lib/utils";

type PerxonaBadgeProps = {
  className?: string;
};

/** Phase 4 — sponsor branding. Renders a small "Powered by Perxona" mark. */
export function PerxonaBadge({ className }: PerxonaBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      Powered by <span className="font-semibold text-foreground">Perxona</span>
    </span>
  );
}
