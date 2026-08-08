import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import type { DocInput, GroundingAnswer } from "@/shared/contract";
import { useAppStore, type SetupStep } from "@/state/app-store";
import { useAvatar } from "@/state/avatar-context";
import { useCatalog } from "@/hooks/use-catalog";
import { resolveDefaults } from "@/lib/presets";
import { DENTIST_DEMO } from "@/fixtures/dentist-demo";
import { pipeline } from "@/state/pipeline";
import { DocUpload } from "./DocUpload";
import { Grounding } from "./Grounding";
import { ScenarioPicker } from "./ScenarioPicker";
import { ReferenceSearch } from "./ReferenceSearch";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS: { key: SetupStep; label: string }[] = [
  { key: "doc", label: "Document" },
  { key: "grounding", label: "Goal" },
  { key: "scenario", label: "Scenario" },
];

const INVITE_LINE = {
  en: "こんにちは! I'm Meeks — your practice-call coach. I'll help you talk to Japanese offices with confidence. Tap Get started when you're ready.",
};

const GUIDES: Record<SetupStep, { en: string }> = {
  doc: {
    en: "Great! Show me the letter you need help with — or just describe the issue in your own words.",
  },
  grounding: {
    en: "Got it! A couple of quick questions and I'll know exactly what you need to say.",
  },
  scenario: {
    en: "Almost there! Pick the office setting for your call — I'll play the staff member for you.",
  },
};

export function SetupScreen() {
  const {
    state,
    setSetupStep,
    setSetupOpen,
    parsed,
    saveAnswers,
    chooseScenario,
    setSim,
    setCheatSheet,
    setError,
    setBusy,
    toCall,
  } = useAppStore();
  const { setupOpen } = state;
  const catalog = useCatalog();
  const { session, unlockAudio, showGuide, speakGuide, startEager, stopEager } = useAvatar();
  const [analyzing, setAnalyzing] = useState(false);
  const launchedRef = useRef(false);
  const lastGuideStepRef = useRef<SetupStep | null>(null);

  /* Launch the guide avatar (cc051_meeks by default) once the catalog is ready so
     it is present while inviting the user + guiding through setup. */
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

  /* Guide line: invite while the setup pop-up is closed, else per-step.
     Before Get started, Meeks does NOT speak — eager gestures only. */
  useEffect(() => {
    if (!setupOpen) {
      showGuide(INVITE_LINE);
      startEager();
      return () => stopEager();
    }
    stopEager();
    if (state.setupStep === lastGuideStepRef.current) return;
    lastGuideStepRef.current = state.setupStep;
    speakGuide(GUIDES[state.setupStep]);
  }, [setupOpen, state.setupStep, showGuide, speakGuide, startEager, stopEager]);

  useEffect(() => {
    if (!state.doc && state.setupStep !== "doc") setSetupStep("doc");
  }, [state.doc, state.setupStep, setSetupStep]);

  const handleGetStarted = useCallback(() => {
    setSetupOpen(true);
    /* This click is a user gesture — unlock audio so Meeks speaks. */
    void unlockAudio().catch(() => {});
  }, [setSetupOpen, unlockAudio]);

  /* One-click demo: canned dentist-appointment scenario, anime scene. */
  const handleDemo = useCallback(() => {
    chooseScenario(DENTIST_DEMO.scenario);
    setSim(DENTIST_DEMO.script, DENTIST_DEMO.glossary);
    setCheatSheet(DENTIST_DEMO.cheatSheet);
    void session.launch(DENTIST_DEMO.scenario).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to launch the presenter.");
    });
    toCall();
  }, [chooseScenario, setSim, setCheatSheet, setError, session, toCall]);

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
        const result = await pipeline.runSim(
          state.summary,
          state.answers,
          state.docSummary,
          state.reference,
        );
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

  /* Invite state — the avatar is on screen with a Get started trigger. */
  if (!setupOpen) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-3 pb-44">
          <Button
            size="lg"
            onClick={handleGetStarted}
            className="gap-2 px-8 py-6 text-lg shadow-xl"
          >
            <Sparkles className="size-5" />
            Get started
          </Button>
          <p className="text-sm text-muted-foreground">
            Meet Meeks — your practice-call coach.
          </p>
        </div>
      </div>
    );
  }

  /* Setup pop-up — compact panel, at most ~25% of the screen. */
  return (
    <div className="flex min-h-svh items-center justify-end px-4 py-6 pr-4 md:pr-8">
      <div className="w-1/4 min-w-[320px] rounded-2xl border bg-card/90 p-5 shadow-xl backdrop-blur-md sm:p-6">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-semibold text-primary">Set up your call</h2>
          <p className="text-sm text-muted-foreground">
            Three quick steps, then we connect you with the ward office.
          </p>
        </div>

        <div className="mt-4 flex items-center gap-1.5">
          {STEPS.map((step, i) => {
            const done = i < stepIndex;
            const active = i === stepIndex;
            return (
              <div key={step.key} className="flex flex-1 items-center gap-1.5">
                <div
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-medium",
                    done && "border-primary bg-primary text-primary-foreground",
                    active && "border-primary bg-primary/10 text-primary",
                    !done && !active && "border-border text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : i + 1}
                </div>
                <span
                  className={cn(
                    "text-xs",
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

        <div className="mt-5">
          {state.setupStep === "doc" && (
            <div className="flex flex-col gap-4">
              <Button
                variant="outline"
                onClick={handleDemo}
                className="justify-center gap-2 border-accent/50 text-primary hover:bg-accent/20"
              >
                <Sparkles className="size-4 text-accent" />
                Try the demo — book a dentist appointment
              </Button>
              <DocUpload onAnalyzed={analyzeDoc} busy={analyzing} />
            </div>
          )}
          {state.setupStep === "grounding" && (
            <div className="flex flex-col gap-4">
              <ReferenceSearch agency={state.docSummary?.issuingAgency} />
              <Grounding
                questions={state.questions}
                summary={state.summary}
                onComplete={handleAnswers}
                busy={state.busy}
              />
            </div>
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
