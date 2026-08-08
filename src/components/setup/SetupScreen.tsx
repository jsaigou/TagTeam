import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { DocInput, GroundingAnswer } from "@/shared/contract";
import { useAppStore, type SetupStep } from "@/state/app-store";
import { pipeline } from "@/state/pipeline";
import { DocUpload } from "./DocUpload";
import { Grounding } from "./Grounding";
import { ScenarioPicker } from "./ScenarioPicker";
import { cn } from "@/lib/utils";

const STEPS: { key: SetupStep; label: string }[] = [
  { key: "doc", label: "Document" },
  { key: "grounding", label: "Goal" },
  { key: "scenario", label: "Scenario" },
];

export function SetupScreen() {
  const { state, setSetupStep, parsed, saveAnswers, chooseScenario, setSim, setError, setBusy, toCall } =
    useAppStore();
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!state.doc && state.setupStep !== "doc") setSetupStep("doc");
  }, [state.doc, state.setupStep, setSetupStep]);

  const analyzeDoc = useCallback(
    async (doc: DocInput) => {
      setAnalyzing(true);
      setBusy(true);
      try {
        const result = await pipeline.parseDoc(doc);
        parsed(result.summary, result.doc, result.questions);
        setSetupStep("grounding");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read document");
      } finally {
        setAnalyzing(false);
        setBusy(false);
      }
    },
    [parsed, setBusy, setError, setSetupStep],
  );

  const handleAnswers = useCallback(
    (answers: GroundingAnswer[]) => {
      saveAnswers(answers);
      setSetupStep("scenario");
    },
    [saveAnswers, setSetupStep],
  );

  const handleScenario = useCallback(
    async (scenario: { avatarId: string; sceneId: string; voiceId: string }) => {
      chooseScenario(scenario);
      setBusy(true);
      try {
        const result = await pipeline.runSim(state.summary, state.answers, state.docSummary);
        setSim(result.script, result.glossary);
        toCall();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate simulation");
      } finally {
        setBusy(false);
      }
    },
    [chooseScenario, setBusy, setSim, toCall, state.summary, state.answers, state.docSummary, setError],
  );

  const stepIndex = useMemo(
    () => STEPS.findIndex((s) => s.key === state.setupStep),
    [state.setupStep],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-primary">Set up your call</h2>
        <p className="text-sm text-muted-foreground">
          Three quick steps, then we connect you with the ward office.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {STEPS.map((step, i) => {
          const done = i < stepIndex;
          const active = i === stepIndex;
          return (
            <div key={step.key} className="flex flex-1 items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary bg-primary/10 text-primary",
                  !done && !active && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-4" /> : i + 1}
              </div>
              <span
                className={cn(
                  "text-sm",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          );
        })}
      </div>

      {state.setupStep === "doc" && <DocUpload onAnalyzed={analyzeDoc} busy={analyzing} />}
      {state.setupStep === "grounding" && (
        <Grounding
          questions={state.questions}
          summary={state.summary}
          onComplete={handleAnswers}
          busy={state.busy}
        />
      )}
      {state.setupStep === "scenario" && <ScenarioPicker onChoose={handleScenario} busy={state.busy} />}

      {state.error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
    </div>
  );
}
