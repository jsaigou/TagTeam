import { cn } from "@/lib/utils";

/** Large, low-opacity leaf motif for otherwise-flat full-viewport screens
    (invite hero, login) — desktop-only, purely decorative. */
export function LeafBackdrop({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      className={cn(
        "pointer-events-none absolute -top-24 -right-40 hidden h-[520px] w-[520px] text-accent opacity-[0.08] lg:block xl:-top-32 xl:-right-32 xl:h-[640px] xl:w-[640px]",
        className,
      )}
    >
      <path
        fill="currentColor"
        d="M100 10c49.7 0 90 40.3 90 90s-40.3 90-90 90S10 149.7 10 100 50.3 10 100 10Zm0 20c-20 25-30 47-30 70 0 27.6 22.4 50 50 50s50-22.4 50-50c0-23-10-45-30-70-13 12-20 24-20 38 0 8-4 12-10 12s-10-4-10-12c0-14-7-26-20-38Z"
      />
    </svg>
  );
}
