import { useMemo, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import type { GroundingAnswer, GroundingQuestion } from "@/shared/contract";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type GroundingProps = {
  questions: GroundingQuestion[];
  summary: string | null;
  onComplete: (answers: GroundingAnswer[]) => void;
  busy: boolean;
};

export function Grounding({ questions, summary, onComplete, busy }: GroundingProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const canContinue = useMemo(
    () => questions.every((q) => (answers[q.id] ?? "").trim().length > 0),
    [questions, answers],
  );

  const setAnswer = (id: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));

  const finish = () => {
    const list: GroundingAnswer[] = questions.map((q) => ({
      questionId: q.id,
      answer: answers[q.id] ?? "",
    }));
    onComplete(list);
  };

  return (
    <div className="flex flex-col gap-6">
      {summary && (
        <div className="rounded-lg border bg-card p-4 text-sm">
          <p className="font-medium text-primary">What we read</p>
          <p className="mt-1 text-muted-foreground">{summary}</p>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {questions.map((q) => (
          <div key={q.id} className="flex flex-col gap-2">
            <p className="font-medium">{q.question}</p>
            {q.options ? (
              <div className="flex flex-wrap gap-2">
                {q.options.map((opt) => {
                  const active = answers[q.id] === opt;
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setAnswer(q.id, opt)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:bg-accent/30",
                      )}
                    >
                      {active && <Check className="size-3.5" />}
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Textarea
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswer(q.id, e.target.value)}
                placeholder="Type your answer…"
                className="min-h-20"
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <Button onClick={finish} disabled={!canContinue || busy} size="lg">
          Continue
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
