import { useState } from "react";
import { Check, Copy, Printer, RotateCcw } from "lucide-react";
import type { CheatSheet } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PerxonaBadge } from "@/components/brand/PerxonaBadge";

type CheatSheetViewProps = {
  sheet: CheatSheet;
  onRestart: () => void;
};

function buildPlainText(sheet: CheatSheet): string {
  const lines = [
    `TagTeam: ${sheet.goal}`,
    "",
    "Key phrases",
    ...sheet.keyPhrases.map(
      (p) => `${p.jp} (${p.furigana}): ${p.en}  [when: ${p.when}]`,
    ),
    "",
    "Practice",
    ...sheet.practice.map((p) => `• ${p}`),
  ];
  if (sheet.targetRules && sheet.targetRules.length > 0) {
    lines.push(
      "",
      "Office rules",
      ...sheet.targetRules.map((r) => `• [${r.kind}] ${r.rule}  (source: ${r.source})`),
    );
  }
  return lines.join("\n");
}

export function CheatSheetView({ sheet, onRestart }: CheatSheetViewProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildPlainText(sheet));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 print:max-w-none print:py-0">
      <div className="no-print flex items-center justify-between">
        <Button variant="ghost" onClick={onRestart}>
          <RotateCcw />
          New call
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-sm print:rounded-none print:border-none print:shadow-none">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">Your goal</p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight print:text-3xl">{sheet.goal}</h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">Key phrases</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {sheet.keyPhrases.map((phrase, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
              <p className="text-lg font-semibold">{phrase.jp}</p>
              <p className="text-sm text-muted-foreground">{phrase.furigana}</p>
              <Separator className="my-2" />
              <p className="text-sm">{phrase.en}</p>
              <p className="mt-1 text-xs text-muted-foreground">When: {phrase.when}</p>
            </div>
          ))}
        </div>
      </section>

      {sheet.practice.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-primary">Practice</h2>
          <ul className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            {sheet.practice.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="font-semibold text-accent">{i + 1}.</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sheet.targetRules && sheet.targetRules.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-primary">Know before you call</h2>
          <div className="grid gap-3">
            {sheet.targetRules.map((rule) => (
              <div key={rule.id} className="flex flex-col gap-1 rounded-xl border bg-card p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{rule.rule}</p>
                  <span className="shrink-0 rounded-full border border-accent/40 px-2 py-px text-[10px] font-medium uppercase tracking-wide text-accent">
                    {rule.kind.replace("_", " ")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Source: {rule.source}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="no-print flex items-center justify-end">
        <PerxonaBadge />
      </footer>
    </div>
  );
}
