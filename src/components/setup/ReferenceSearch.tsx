import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2, Search } from "lucide-react";
import {
  streamSearchReference,
  type ReferenceHit,
  type ReferencePageEvent,
} from "@/lib/api";
import { useAppStore } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
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

/** Web-search reference info about the office the user will call. Results are
 *  streamed via SSE so hits and scraped pages appear as they're found, and Luna
 *  visibly "researches" (thinking state) while the search runs. */
export function ReferenceSearch({ agency, purpose }: ReferenceSearchProps) {
  const { setReference, setError } = useAppStore();
  const { session: avatar } = useAvatar();
  const defaultQuery = useMemo(() => {
    // Prefill the agency only if it plausibly is one; otherwise fall back to the
    // doc purpose (meaningful search), else leave the box empty for the user.
    if (looksLikeAgency(agency)) return agency!.trim();
    if (looksLikePurpose(purpose)) return purpose!.trim();
    return "";
  }, [agency, purpose]);
  const [query, setQuery] = useState(defaultQuery);
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<ReferenceHit[]>([]);
  const [pages, setPages] = useState<ReferencePageEvent[]>([]);
  const [digestReady, setDigestReady] = useState(false);
  const closeStreamRef = useRef<(() => void) | null>(null);

  /* Clean up an in-flight stream on unmount. */
  useEffect(() => {
    return () => closeStreamRef.current?.();
  }, []);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setHits([]);
    setPages([]);
    setDigestReady(false);
    setReference("");
    /* Luna visibly researches while the search runs. */
    avatar.setThinking(true);
    try {
      closeStreamRef.current?.();
      closeStreamRef.current = streamSearchReference(q, {
        onHits: (_q, results) => setHits(results),
        onPage: (event) => setPages((prev) => [...prev, event]),
        onDone: (result) => {
          setReference(result.digest);
          setDigestReady(true);
          setLoading(false);
          avatar.setThinking(false);
        },
        onError: (message) => {
          setError(message);
          setDigestReady(true);
          setLoading(false);
          avatar.setThinking(false);
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setLoading(false);
      avatar.setThinking(false);
    }
  }, [query, loading, setReference, setError, avatar]);

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

      {/* Live progress: hits first, then each scraped page as it completes. */}
      {loading && (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin text-accent" />
            Searching… (Luna is researching)
          </p>
          {hits.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {hits.map((h) => (
                <li key={h.url} className="flex items-start gap-1.5 text-xs">
                  <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{h.title}</span>{" "}
                    <a
                      href={h.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-primary"
                    >
                      <ExternalLink className="size-2.5" />
                    </a>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pages.length > 0 && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <FileText className="size-3.5 text-accent" />
              Read {pages.length} of {pages[0]?.total ?? pages.length} page
              {pages.length === 1 ? "" : "s"}…
            </p>
          )}
        </div>
      )}

      {!loading && digestReady && hits.length > 0 && (
        <div className="rounded-md bg-muted/50 p-2.5">
          <p className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <CheckCircle2 className="size-3 text-accent" />
            Reference found — will inform the simulation
          </p>
          <p className="line-clamp-4 text-xs text-muted-foreground">
            {`${hits.length} result${hits.length === 1 ? "" : "s"} found`}
            {pages.length > 0 ? `, ${pages.length} page${pages.length === 1 ? "" : "s"} read` : ""}.
          </p>
        </div>
      )}
    </div>
  );
}
