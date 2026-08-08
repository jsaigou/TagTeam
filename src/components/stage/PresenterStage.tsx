import type { RefObject } from "react";

import { cn } from "@/lib/utils";

interface PresenterStageProps {
  stageRef: RefObject<HTMLDivElement | null>;
  /** True once the presenter engine reports Ready. */
  ready: boolean;
  loadError: Error | null;
  onRetryLoad: () => void;
}

/** Full-page `<sv-presenter>` mount with loading and error overlays. The
 *  presenter element is created and appended by `usePresenter` into `stageRef`. */
export function PresenterStage({
  stageRef,
  ready,
  loadError,
  onRetryLoad,
}: PresenterStageProps) {
  return (
    <div className="relative h-svh w-full overflow-hidden bg-background">
      <div ref={stageRef} className="absolute inset-0 isolate" />

      {!ready && !loadError && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div
              className={cn(
                "size-8 animate-spin rounded-full border-2 border-muted",
                "border-t-primary",
              )}
            />
            <p className="text-sm">Loading presenter…</p>
          </div>
        </div>
      )}

      {loadError && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-card px-6 text-center">
          <p className="max-w-md text-sm text-foreground">
            Presenter failed to load.
          </p>
          <button
            type="button"
            onClick={onRetryLoad}
            className={cn(
              "rounded-md bg-primary px-4 py-2 text-sm font-medium",
              "text-primary-foreground transition-colors hover:bg-primary/90",
            )}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
