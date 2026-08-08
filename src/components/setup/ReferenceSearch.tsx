import { useCallback, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { searchReference } from "@/lib/api";
import { useAppStore } from "@/state/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ReferenceSearchProps = {
  /** Detected office/agency to prefill the search. */
  agency?: string | null;
};

/** Web-search reference info about the office the user will call. */
export function ReferenceSearch({ agency }: ReferenceSearchProps) {
  const { state, setReference, setError } = useAppStore();
  const [query, setQuery] = useState(agency ?? "");
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    try {
      const res = await searchReference(q);
      setReference(res.digest);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }, [query, loading, setReference, setError]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
        <Search className="size-4" />
        Research the office
      </p>
      <p className="text-xs text-muted-foreground">
        Search for reference info about the office or agency you'll call — the simulation will be
        grounded in what we find.
      </p>
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void doSearch();
          }}
          placeholder="e.g. 渋谷区役所 保険年金課"
        />
        <Button onClick={() => void doSearch()} disabled={loading || !query.trim()}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>

      {state.reference && (
        <div className="rounded-md bg-muted/50 p-2.5">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3 text-accent" />
            Reference found — will inform the simulation
          </p>
          <p className="line-clamp-4 text-xs text-muted-foreground">
            {state.reference.slice(0, 400)}…
          </p>
        </div>
      )}
    </div>
  );
}
