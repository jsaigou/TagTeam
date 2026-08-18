import { useCallback, useEffect, useState } from "react";
import { History, Trash2 } from "lucide-react";
import { deleteScenario, listScenarios, type ScenarioSummary } from "@/lib/scenario-api";
import { cn } from "@/lib/utils";

type PastCallsProps = {
  /** Restore a saved scenario by id (the parent fetches + populates state). */
  onRestore: (id: string) => void;
  busy?: boolean;
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Phase 5c — list of the user's saved calls, each restorable in one tap. */
export function PastCalls({ onRestore, busy = false }: PastCallsProps) {
  const [items, setItems] = useState<ScenarioSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await listScenarios();
      setItems(page.items);
      setError(null);
    } catch {
      setError("Could not load past calls.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteScenario(id);
        setItems((prev) => (prev ? prev.filter((s) => s.id !== id) : prev));
      } catch {
        /* ignore — the row stays */
      }
    },
    [],
  );

  if (error) return null;
  if (!items || items.length === 0) return null;

  return (
    <div className="mt-4 flex flex-col gap-2 border-t pt-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <History className="size-3.5" />
        Past calls
      </p>
      <div className="flex flex-col gap-1.5">
        {items.slice(0, 4).map((item) => (
          <div key={item.id} className="group flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRestore(item.id)}
              disabled={busy}
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors",
                "hover:border-accent/50 hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span className="truncate text-sm font-medium">{item.title}</span>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {item.role && <span className="capitalize">{item.role}</span>}
                {item.difficulty && <span className="capitalize">· {item.difficulty}</span>}
                {item.pace && <span className="capitalize">· {item.pace}</span>}
                {item.hasCheatSheet ? "· cheat sheet" : ""}
                {formatDate(item.createdAt) && (
                  <span className="ml-auto shrink-0 tabular-nums">{formatDate(item.createdAt)}</span>
                )}
              </span>
            </button>
            <button
              type="button"
              title="Delete this call"
              onClick={() => void handleDelete(item.id)}
              className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
