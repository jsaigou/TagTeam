import { Button } from "@/components/ui/button";

/** Workflow 1's inline confirmation: "Searching X — correct?" with Yes/No.
 *  Voice works too — bare yes/no fast-paths through the intent classifier. */
export function CandidateConfirm({
  name,
  onAnswer,
}: {
  name: string;
  onAnswer: (answer: "yes" | "no") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2">
      <p className="min-w-0 flex-1 text-sm">
        Searching for <span className="font-medium">“{name}”</span> — correct?
      </p>
      <Button size="sm" onClick={() => onAnswer("yes")}>
        Yes
      </Button>
      <Button size="sm" variant="outline" onClick={() => onAnswer("no")}>
        No
      </Button>
    </div>
  );
}
