import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, X } from "lucide-react";
import type { JobSnapshot, RunSnapshot } from "@/shared/contract";
import { useSession } from "@/state/session-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Status icon for one job in the feed. */
function JobIcon({ job }: { job: JobSnapshot }) {
  switch (job.status) {
    case "done":
      return <Check className="size-3.5 text-primary" />;
    case "running":
      return <Loader2 className="size-3.5 animate-spin text-primary" />;
    case "needs_input":
      return <span className="size-2 animate-pulse rounded-full bg-amber-500" />;
    case "failed":
    case "canceled":
    case "superseded":
      return <AlertCircle className="size-3.5 text-destructive" />;
    default:
      return <span className="size-2 rounded-full bg-muted-foreground/40" />;
  }
}

/** The confirmTarget gate — the research candidates, one selectable at a
 *  time (the engine's speculative guess pre-selected), with explicit
 *  confirm/reject. Free-text "yes"/"no" in the chat works too (the hub's
 *  classifyIntent fast path), but the buttons never require it. */
function GateCard({ run }: { run: RunSnapshot }) {
  const { sendConfirm } = useSession();
  const gate = run.gate;
  const [selectedId, setSelectedId] = useState<string | null>(gate?.guessId ?? null);

  /* A new gate (or a re-opened one) resets the selection to the guess. */
  useEffect(() => {
    setSelectedId(gate?.guessId ?? null);
  }, [run.runId, gate?.guessId]);

  if (!gate) return null;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-sm font-medium">Is this the right place?</p>
      <div className="flex flex-col gap-1.5">
        {gate.candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelectedId(c.id)}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2 text-left transition-colors",
              selectedId === c.id
                ? "border-primary ring-1 ring-primary"
                : "border-border hover:border-primary/50",
            )}
          >
            <span className="text-sm font-medium leading-tight">{c.name}</span>
            {c.snippet && (
              <span className="line-clamp-2 text-xs text-muted-foreground">{c.snippet}</span>
            )}
            {c.id === gate.guessId && (
              <span className="text-[11px] font-medium text-primary">Best guess</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!selectedId}
          onClick={() => selectedId && sendConfirm(run.runId, selectedId)}
        >
          Yes, that's it
        </Button>
        <Button size="sm" variant="outline" onClick={() => sendConfirm(run.runId, null)}>
          None of these
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Or just tell Luna — “yes” or “no” works too.
      </p>
    </div>
  );
}

/** The server-authoritative run, visualized: one row per graph step (status +
 *  progress), the confirmTarget gate when it opens, and a cancel affordance.
 *  Presentational — applying the delivered scenario is SetupScreen's job. */
export function RunStatus() {
  const { run, cancelRun } = useSession();
  if (!run) return null;

  const failed = run.jobs.some((j) => j.status === "failed");

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border bg-card/80 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="line-clamp-1 text-sm font-medium" title={run.goal}>
          {run.result
            ? "Your practice call is ready"
            : run.gate
              ? "Quick check before I write the call"
              : "Getting everything ready…"}
        </p>
        <button
          type="button"
          aria-label="Cancel run"
          title="Cancel"
          onClick={() => cancelRun(run.runId)}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {run.jobs.map((job) => (
          <div key={job.id} className="flex items-start gap-2 text-xs">
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              <JobIcon job={job} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span
                className={cn(
                  "leading-tight",
                  job.status === "failed" && "text-destructive",
                  job.status === "done" && "text-muted-foreground",
                )}
              >
                {job.label}
              </span>
              {job.detail && job.status === "running" && (
                <span className="text-muted-foreground">{job.detail}</span>
              )}
              {job.error && job.status === "failed" && (
                <span className="text-destructive">{job.error.message}</span>
              )}
              {typeof job.progress === "number" && job.status === "running" && (
                <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-border">
                  <span
                    className="block h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(job.progress * 100)}%` }}
                  />
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {run.gate && <GateCard run={run} />}

      {!run.gate && !run.result && failed && (
        <p className="text-xs text-muted-foreground">
          Something didn't work — tell Luna what you need again and I'll retry.
        </p>
      )}
    </div>
  );
}
