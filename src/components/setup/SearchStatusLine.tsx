import { CheckCircle2, Loader2, SearchX } from "lucide-react";
import type { ChatSearch } from "@/hooks/use-setup-chat";
import { cn } from "@/lib/utils";

export function SearchStatusLine({ search }: { search: ChatSearch }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs",
        search.status === "error"
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-accent/30 bg-accent/5 text-muted-foreground",
      )}
    >
      {search.status === "searching" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
      ) : search.status === "done" ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-accent" />
      ) : (
        <SearchX className="size-3.5 shrink-0" />
      )}
      <span>
        {search.status === "done"
          ? "Searched"
          : search.status === "error"
            ? "Search failed"
            : "Searching"}{" "}
        for <span className="font-medium text-foreground">“{search.query}”</span>
      </span>
      {search.hits > 0 && (
        <span className="text-accent">
          , {search.hits} result{search.hits === 1 ? "" : "s"} found
          {search.pagesRead > 0 ? `, ${search.pagesRead} page${search.pagesRead === 1 ? "" : "s"} read` : ""}
        </span>
      )}
    </div>
  );
}
