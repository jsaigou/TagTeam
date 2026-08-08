import { useCallback, useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { searchReference } from "@/lib/api";
import { useAppStore } from "@/state/app-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ReferenceSearchProps = {
  /** Detected office/agency to prefill the search. */
  agency?: string | null;
  /** Doc purpose — fallback prefill when the extracted agency is unreliable. */
  purpose?: string | null;
};

/** Filler/meaningless values the LLM sometimes returns for issuingAgency. */
const AGENCY_FILLER =
  /利用者|ユーザー|ユーザ|本人|私|わたし|あなた|不明|該当|なし|問題|状況|内容|目的|電話|相談/;

function looksLikeAgency(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (v.length < 2 || v.length > 40) return false;
  if (AGENCY_FILLER.test(v)) return false;
  // An agency name is a Japanese proper noun (kanji/kana); reject romanized filler.
  if (!/[\u4e00-\u9fff\u3040-\u30ff]/.test(v)) return false;
  return true;
}

function looksLikePurpose(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  return v.length >= 3 && v.length <= 80 && !/利用者|不明/.test(v);
}

/** Web-search reference info about the office the user will call. */
export function ReferenceSearch({ agency, purpose }: ReferenceSearchProps) {
  const { state, setReference, setError } = useAppStore();
  const defaultQuery = useMemo(() => {
    // Prefill the agency only if it plausibly is one; otherwise fall back to the
    // doc purpose (meaningful search), else leave the box empty for the user.
    if (looksLikeAgency(agency)) return agency!.trim();
    if (looksLikePurpose(purpose)) return purpose!.trim();
    return "";
  }, [agency, purpose]);
  const [query, setQuery] = useState(defaultQuery);
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
