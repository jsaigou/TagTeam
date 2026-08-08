import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { DocInput, GroundingAnswer } from "@/shared/contract";
import { useAppStore, type SetupStep } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { useCatalog } from "@/hooks/use-catalog";
import { resolveDefaults } from "@/lib/presets";
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

const GUIDES: Record<SetupStep, { en: string; jp: string }> = {
  doc: {
    en: "Welcome! I'm Meeks. Let's set up your practice call — upload a photo of the document you need help with.",
    jp: "こんにちは！メイクスです。練習の準備をしましょう。まず、書類の写真をアップロードしてください。",
  },
  grounding: {
    en: "Got it! Let me ask a couple of quick questions so I know exactly what you need.",
    jp: "わかりました。いくつか確認させてください。",
  },
  scenario: {
    en: "Almost there! Pick the setting for your call — I'll play the office for you.",
    jp: "もう少しです。通話の設定を選んでください。",
  },
};

export function SetupScreen() {
  const {
    state,
    setSetupStep,
    parsed,
    saveAnswers,
    chooseScenario,
    setSim,
    setError,
    setBusy,
    toCall,
  } = useAppStore();
  const catalog = useCatalog();
  const { session, speakGuide } = useAvatar();
  const [analyzing, setAnalyzing] = useState(false);
  const launchedRef = useRef(false);
  const lastGuideStepRef = useRef<SetupStep | null>(null);

  /* Launch the star avatar (cc051_meeks by default) once the catalog is ready so
     it is present while guiding through setup. */
  useEffect(() => {
    if (launchedRef.current || catalog.isLoading) return;
    const defaults = resolveDefaults(catalog.avatars, catalog.scenes, catalog.voices);
    if (!defaults) return;
    launchedRef.current = true;
    void session
      .launch(defaults)
      .catch((err) => {
        launchedRef.current = false;
        setError(err instanceof Error ? err.message : "Failed to launch the presenter.");
      });
  }, [catalog, session, setError]);

  /* Guide line per setup step. */
  useEffect(() => {
    if (state.setupStep === lastGuideStepRef.current) return;
    lastGuideStepRef.current = state.setupStep;
    speakGuide(GUIDES[state.setupStep]);
  }, [state.setupStep, speakGuide]);

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
        await session.launch(scenario);
        toCall();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate simulation");
      } finally {
        setBusy(false);
      }
    },
    [
      chooseScenario,
      setBusy,
      setSim,
      toCall,
      state.summary,
      state.answers,
      state.docSummary,
      setError,
      session,
    ],
  );

  const stepIndex = useMemo(
    () => STEPS.findIndex((s) => s.key === state.setupStep),
    [state.setupStep],
  );

  return (
    <div className="flex min-h-svh items-center justify-end px-4 py-8 pr-6 md:pr-16">
      <div className="w-full max-w-xl rounded-2xl border bg-card/85 p-6 shadow-xl backdrop-blur-md sm:p-8">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold text-primary">Set up your call</h2>
          <p className="text-sm text-muted-foreground">
            Three quick steps, then we connect you with the ward office.
          </p>
        </div>

        <div className="mt-5 flex items-center gap-2">
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

        <div className="mt-6">
          {state.setupStep === "doc" && <DocUpload onAnalyzed={analyzeDoc} busy={analyzing} />}
          {state.setupStep === "grounding" && (
            <Grounding
              questions={state.questions}
              summary={state.summary}
              onComplete={handleAnswers}
              busy={state.busy}
            />
          )}
          {state.setupStep === "scenario" && (
            <ScenarioPicker
              onChoose={handleScenario}
              busy={state.busy}
              avatars={catalog.avatars}
              scenes={catalog.scenes}
              voices={catalog.voices}
              isLoading={catalog.isLoading}
              error={catalog.error}
            />
          )}

          {state.error && (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {state.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
