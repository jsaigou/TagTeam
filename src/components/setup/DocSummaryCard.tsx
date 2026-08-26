import { FileText, Check } from "lucide-react";
import type { DocSummary } from "@/lib/doc-parser";

/** English-language summary of a parsed Japanese document, shown immediately
 *  after upload so the user understands what they received before answering
 *  questions. Targets non-Japanese-reading English speakers. */
export function DocSummaryCard({ summary }: { summary: DocSummary }) {
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            What this document says
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-foreground">
            {summary.englishSummary}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {summary.documentType}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {summary.issuingAgency}
            </span>
          </div>
        </div>
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
          <Check className="size-3.5" />
        </span>
      </div>
    </div>
  );
}
