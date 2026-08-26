import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, FileText, Mic, Sparkles, PhoneCall } from "lucide-react";
import type { DocInput, GroundingAnswer, RoleId, TargetProfile } from "@/shared/contract";
import { useAppStore, type SetupStep } from "@/state/app-store";
import { useAvatar, GREETING_WAVE_MOTION } from "@/state/avatar-context";
import { useSession } from "@/state/session-context";
import { useCatalog } from "@/hooks/use-catalog";
import { useSetupChat } from "@/hooks/use-setup-chat";
import { resolveDefaults, packToSelection } from "@/lib/presets";
import { PANEL_HEADER_CLEAR, PANEL_TOP, setAvatarAnchor } from "@/lib/avatar-window";
import { getScenario } from "@/lib/scenario-api";
import { pipeline } from "@/state/pipeline";
import { useFillers } from "@/hooks/use-fillers";
import { DocUpload } from "./DocUpload";
import { Grounding } from "./Grounding";
import { ScenarioPicker } from "./ScenarioPicker";
import { ReferenceSearch } from "./ReferenceSearch";
import { PastCalls } from "./PastCalls";
import { RunStatus } from "./RunStatus";
import { DoorsIntro } from "./DoorsIntro";
import { LunaChatPanel } from "./LunaChatPanel";
import { SearchPapersOverlay } from "./SearchPapersOverlay";
import { PerxonaBadge } from "@/components/brand/PerxonaBadge";
import { Button } from "@/components/ui/button";
import { unlockSfx } from "@/lib/sfx";
import { cn } from "@/lib/utils";

const STEPS: { key: SetupStep; label: string }[] = [
  { key: "doc", label: "Document" },
  { key: "grounding", label: "Goal" },
  { key: "scenario", label: "Scenario" },
];

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

/** Luna's line when the doors open on her (Get Started door reveal) — the
 *  single combined opener; the doc-step guide is folded into it (the step
 *  effect skips the initial step so this is the only opening message). */
const GREETING_LINE = {
  en: "Hi I'm Luna. Describe your issue or upload the doc you need to respond to.",
};

export function SetupScreen() {
  const {
    state,
    setSetupStep,
    setSetupOpen,
    setIntroPhase,
    setDoc,
    parsed,
    saveAnswers,
    chooseScenario,
    setSettings,
    setSim,
    restoreScenario,
    setError,
    setBusy,
    setReference,
    toCall,
    toPrep,
    toCheatSheet,
  } = useAppStore();
  const { setupOpen } = state;
  const catalog = useCatalog();
  const { session, unlockAudio, speakGuide } = useAvatar();
  /* Phase 7b slice 6 — the server-authoritative run: this screen's chat rides
     `sendIntent` (classify → maybe start a run), RunStatus renders the feed
     and gate, and the delivered scenario drops into the store below.
     Conversation-first: `onClassified` drives Luna's workflow dialogue and
     `cancelRun` executes a candidate rejection (cancel Gemma mid-search). */
  const { run, sendIntent, cancelRun, onClassified, setLunaLine } = useSession();

  const stepLabel = STEPS.find((s) => s.key === state.setupStep)?.label ?? state.setupStep;

  const {
    chat,
    handleSpeakGuide,
    guideChat,
    chatSearch,
    candidate,
    sendChat,
    answerCandidate,
    lunaThinking,
    gemmaBusy,
    buildRunContext,
  } = useSetupChat({
    stepLabel,
    summary: state.summary,
    answers: state.answers,
    settings: state.settings,
    docSummary: state.docSummary,
    doc: state.doc,
    speakGuide,
    setLunaLine,
    setThinking: session.setThinking,
    isSpeaking: session.isSpeaking,
    setReference,
    run,
    sendIntent,
    cancelRun,
    onClassified,
  });

  /* Ambient processing (product spec): while Gemma's background work runs —
     Luna's own LLM turn, the chat-triggered search, or any active run step —
     she vocalizes short fillers instead of sitting silent. English during
     setup; the Japanese call context takes over later. */
  useFillers({
    active: setupOpen && gemmaBusy,
    lang: "en",
    speak: (text) => void session.speak(text),
    isSpeaking: () => session.isSpeaking,
  });

  const [analyzing, setAnalyzing] = useState(false);
  const launchedRef = useRef(false);
  /* Seeded with the initial step: the doc-step guide is folded into
     GREETING_LINE, so the effect speaks only on later step changes. */
  const lastGuideStepRef = useRef<SetupStep | null>("doc");

  /* Launch the guide avatar (Luna / cc051_meeks by default). QA round: NOT on
     page load anymore — once the presenter activates, its render surface
     overrides ancestor visibility and bled through the Get Started hero ~5s
     in. Launch when the door intro starts instead: its ~7s run doubles as
     asset-loading cover, so she waves in the doorway as the doors part.
     Restores and delivered runs launch explicitly in their own flows. */
  useEffect(() => {
    if (launchedRef.current || state.introPhase !== "running") return;
    const defaults = resolveDefaults(catalog.avatars, catalog.scenes, catalog.voices);
    if (!defaults || catalog.isLoading) return;
    launchedRef.current = true;
    void session
      .launch(defaults)
      .catch((err) => {
        launchedRef.current = false;
        setError(err instanceof Error ? err.message : "Failed to launch the presenter.");
      });
  }, [catalog, state.introPhase, session, setError]);

  /* Guide line per setup step while the panel is open. Dialogue stays silent
     until the door intro has fully faded (or been skipped) — Luna's greeting
     is the first thing you hear, then the per-step lines take over. */
  useEffect(() => {
    if (!setupOpen || state.introPhase !== "idle") return;
    if (state.setupStep === lastGuideStepRef.current) return;
    lastGuideStepRef.current = state.setupStep;
    handleSpeakGuide(GUIDES[state.setupStep]);
  }, [setupOpen, state.introPhase, state.setupStep, handleSpeakGuide]);

  /* Conversation-first: no forced doc step — the chat is the entry point, so
     a user who just states their task is never bounced back to "Document".
     The panels below simply appear as the state earns them. */

  const handleGetStarted = useCallback(() => {
    /* This click is a user gesture — enable audio (presenter speech + the
       knock SFX), then run the door intro. The centered main UI appears
       immediately; the door plays over Luna's corner window on top of it. */
    void unlockAudio().catch(() => {});
    void unlockSfx();
    setIntroPhase("running");
    setSetupOpen(true);
  }, [setIntroPhase, setSetupOpen, unlockAudio]);

  const handleIntroFinish = useCallback(
    (skip: boolean) => {
      /* A skip may land mid-wave — don't let her keep gesturing over the UI. */
      if (skip) session.interrupt();
      setIntroPhase("idle");
      /* Dialogue triggers only after the door fade completes (a skip counts
         as dismissal — no greeting; the step guide picks up instead). */
      if (!skip) handleSpeakGuide(GREETING_LINE);
    },
    [session, setIntroPhase, handleSpeakGuide],
  );

  const handleIntroReveal = useCallback(() => {
    /* Wave silently while the doors hold open — speech waits for the fade. */
    void session.playMotion(GREETING_WAVE_MOTION).catch(() => {});
  }, [session]);

  const analyzeDoc = useCallback(
    async (doc: DocInput) => {
      /* Workflow 3 — the avatar acks immediately; Gemma's extraction (the
         client-side parse here, the server parseDocument step on next intent)
         runs behind it. */
      handleSpeakGuide({ en: "Thank you. Let me read this over." });
      /* Keep the DocInput in the store — the run context builder uploads its
         pages to the server's ephemeral store when the user states their
         objective (the parseDocument step's input). */
      setDoc(doc);
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
    [setDoc, parsed, setBusy, setError, setSetupStep, handleSpeakGuide],
  );

  /** Workflow 3 entry: a file picked right in the chat becomes a DocInput. */
  const handleAttachFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result !== "string") return;
        void analyzeDoc({ kind: "image", dataUrl: reader.result, mimeType: file.type || "image/jpeg" });
      };
      reader.readAsDataURL(file);
    },
    [analyzeDoc],
  );

  const handleAnswers = useCallback(
    (answers: GroundingAnswer[]) => {
      saveAnswers(answers);
      setSetupStep("scenario");
      /* Auto-suggest who answers the phone from the document + answers. Best
         effort — if inference fails or is slow, the default role stays and the
         user can pick. Non-blocking so the scenario screen shows immediately. */
      if (state.docSummary) {
        void pipeline
          .suggestRole(state.docSummary, answers)
          .then((role) => setSettings({ role }))
          .catch(() => {});
      }
    },
    [saveAnswers, setSetupStep, state.docSummary, setSettings],
  );

  /* The ScenarioPicker's "Start simulation" now starts a real run (server
     graph — classify-then-fill, target grounding) instead of the old
     client-side pipeline.runSim call, same as the chat's sendIntent path.
     Result application (setSim + toPrep) happens in the run?.result effect
     below, shared with the chat flow — this handler only kicks the run off. */
  const handleScenario = useCallback(
    (objective: string, role: RoleId) => {
      setSettings({ ...state.settings, role });
      setBusy(true);
      buildRunContext()
        .then((context) => sendIntent(objective, context))
        .catch(() => {
          setBusy(false);
          setError("Could not start the call — please try again.");
        });
    },
    [setSettings, state.settings, setBusy, buildRunContext, sendIntent, setError],
  );

  /* Phase 5c — restore a saved call: fetch it, populate the store, relaunch the
     avatar with the stored selection (or the role's pack) and jump straight in. */
  const handleRestore = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const stored = await getScenario(id);
        if (!stored || !stored.script) {
          setError("That call could not be loaded.");
          return;
        }
        const selection =
          stored.selection ??
          (stored.settings
            ? packToSelection(stored.settings.role)
            : null);
        if (!selection) {
          setError("That call is missing its avatar setup.");
          return;
        }
        restoreScenario({
          id: stored.id,
          summary: stored.summary,
          answers: stored.answers,
          reference: stored.reference,
          target: (stored.target as TargetProfile | null | undefined) ?? null,
          settings: stored.settings ?? state.settings,
          selection,
          script: stored.script,
          glossary: stored.glossary,
          cheatSheet: stored.cheatSheet,
        });
        await session.launch(selection);
        if (stored.cheatSheet) {
          toCheatSheet();
        } else {
          toCall();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not restore the call.");
      } finally {
        setBusy(false);
      }
    },
    [
      setBusy,
      setError,
      restoreScenario,
      state.settings,
      session,
      toCheatSheet,
      toCall,
    ],
  );

  /* Phase 7b slice 6 — the run delivered a scenario: drop script + glossary
     into the store and move to the prep briefing (which shows Luna; the
     practice avatar launches at its ready-click). The selection is the
     user's pick when they made one, else the configured role's curated pack
     (the intent path skips the ScenarioPicker). Once-per-runId: the snapshot
     re-broadcasts on every job change. */
  const appliedRunRef = useRef<string | null>(null);
  useEffect(() => {
    const result = run?.result;
    if (!run || !result || appliedRunRef.current === run.runId) return;
    appliedRunRef.current = run.runId;
    const selection = state.scenario ?? packToSelection(state.settings.role);
    if (!selection) {
      setError("That call is missing its avatar setup.");
      return;
    }
    chooseScenario(selection);
    setSim(result.script, result.glossary, result.target ?? null);
    setBusy(false);
    toPrep();
  }, [
    run,
    state.scenario,
    state.settings.role,
    chooseScenario,
    setSim,
    setBusy,
    setError,
    toPrep,
  ]);

  /* A run that dead-ends without a result (e.g. the confirmTarget gate fails
     outright) must not leave the ScenarioPicker's "Start simulation" button
     stuck disabled forever. Only unsticks on a truly dead run — no gate, no
     result, and nothing left queued/running — NOT on "any job failed",
     since a soft dep (e.g. geolocate, extractTargetRules) failing is normal
     and planScenario still finishes the run from there. */
  useEffect(() => {
    if (!run || run.result || run.gate) return;
    if (run.jobs.length === 0) return;
    const stillWorking = run.jobs.some((j) => j.status === "queued" || j.status === "running");
    if (!stillWorking) setBusy(false);
  }, [run, setBusy]);

  /* Invite state — a clean hero (QA round): a short explainer + one prominent
     CTA. Get started opens the centered main UI and plays the corner door
     intro over it; the hero itself never coexists with the intro. Luna's
     avatar stays out of this screen entirely (see AvatarStage's isInvite
     check) so the door-open reveal is still a surprise — the preview card
     below is deliberately abstract, not a peek at her. */
  if (!setupOpen) {
    return (
      <div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 pb-20 sm:pb-24">
        <HeroBackdrop />
        <div className="flex w-full max-w-6xl flex-col items-center gap-14 xl:flex-row xl:items-center xl:justify-between xl:gap-20">
          <div className="flex w-full max-w-xl flex-col items-center gap-5 text-center xl:items-start xl:text-left">
            <h1 className="text-3xl font-bold tracking-tight text-primary sm:text-4xl lg:text-5xl xl:text-6xl">
              Practice your Japanese office calls
            </h1>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground lg:max-w-lg lg:text-lg">
              TagTeam rehearses phone calls with Japanese offices before you make
              them. Just tell Luna what you need — a letter, a link, or your own
              words — and she researches the office, sets up the call, and an AI
              avatar plays the staff member so you can practice.
            </p>
            <Button
              size="lg"
              onClick={handleGetStarted}
              className="mt-2 gap-2 rounded-full px-10 py-7 text-lg shadow-xl"
            >
              <Sparkles className="size-5" />
              Get started
            </Button>
            <PerxonaBadge />

            <ol className="mt-4 grid w-full max-w-md grid-cols-1 gap-5 border-t border-border/60 pt-8 text-left sm:grid-cols-3 sm:gap-4 xl:max-w-none">
              <HeroStep
                icon={<FileText className="size-4" />}
                title="Tell Luna"
                body="A letter, a link, or just your own words."
              />
              <HeroStep
                icon={<PhoneCall className="size-4" />}
                title="She sets it up"
                body="Luna researches the office and preps the call."
              />
              <HeroStep
                icon={<Mic className="size-4" />}
                title="You practice"
                body="An AI avatar plays the staff member on the line."
              />
            </ol>
          </div>

          <CallPreviewCard className="hidden w-full max-w-sm shrink-0 xl:block" />
        </div>
      </div>
    );
  }

  /* Setup card — wide (~80% of the viewport) and starting high so Luna clips
     its top-right corner: she reads as part of the panel instead of floating
     in distant whitespace. The card is REGISTERED as her live anchor, so her
     window is measured against this element (see src/lib/avatar-window.ts). */
  return (
    <>
      <div
        className="flex min-h-svh flex-col items-center justify-start px-4 pb-6"
        style={{ paddingTop: PANEL_TOP }}
      >
      <div
        // A STABLE ref identity (the module-level setAvatarAnchor itself, not
        // a fresh inline arrow function) — an inline `(el) => setAvatarAnchor(el)`
        // gets a new function identity every render, so React detaches
        // (null) and reattaches on EVERY commit; each attach calls emit(),
        // which can trigger a subscriber's setState and another render,
        // occasionally compounding into "Maximum update depth exceeded"
        // during a long-running screen (found while testing Sprint 6's
        // ScenarioPicker against a real multi-step run).
        ref={setAvatarAnchor}
        className="w-full max-w-[80%] overflow-y-auto rounded-2xl border bg-card/90 p-5 shadow-xl backdrop-blur-md sm:p-6 max-h-[calc(100svh-16rem)]"
      >
        {/* Header row keeps right of Luna's footprint while the card top is
            still under her window. */}
        <div
          className="flex flex-col gap-1.5"
          style={{ paddingRight: PANEL_HEADER_CLEAR }}
        >
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold text-primary">Getting ready for your call</h2>
            <p className="text-sm text-muted-foreground">
              Tell Luna what you need — she'll research it and set up your
              practice call. A letter, a link, or just your own words all work.
            </p>
          </div>
          {guideChat.error && (
            <p className="text-xs text-destructive">{guideChat.error}</p>
          )}
        </div>

        <LunaChatPanel
          messages={chat}
          state={guideChat.state}
          supported={guideChat.supported}
          search={chatSearch}
          candidate={candidate}
          onStart={() => guideChat.startVoice()}
          onStop={() => guideChat.stopVoice()}
          onSend={sendChat}
          onCandidateAnswer={answerCandidate}
          onAttach={handleAttachFile}
        />

        <div className="mt-3">
          <RunStatus />
        </div>

        <div className="mt-5">
          {state.setupStep === "doc" && (
            <DocUpload onAnalyzed={analyzeDoc} busy={analyzing} />
          )}
          {state.setupStep === "grounding" && (
            <div className="flex flex-col gap-4">
              <ReferenceSearch
                agency={state.docSummary?.issuingAgency}
                purpose={state.docSummary?.purpose}
              />
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
              onStart={handleScenario}
              busy={state.busy}
              avatars={catalog.avatars}
              isLoading={catalog.isLoading}
              error={catalog.error}
              settings={state.settings}
              onSettingsChange={setSettings}
            />
          )}

          {state.error && (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              {state.error}
            </p>
          )}
        </div>

        <PastCalls onRestore={(id) => void handleRestore(id)} busy={state.busy} />
      </div>
      </div>

      {/* Papers pile up in front of Luna while she works — immediately on
          send (her LLM turn), then through the search itself. */}
      {(lunaThinking || chatSearch?.status === "searching") && <SearchPapersOverlay />}

      {/* The corner door reveal plays over the live, centered UI. */}
      {state.introPhase === "running" && (
        <DoorsIntro onFinish={handleIntroFinish} onReveal={handleIntroReveal} />
      )}
    </>
  );
}

/** One "how it works" entry on the invite hero. */
function HeroStep({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 sm:flex-col sm:items-start sm:gap-2">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent/20 text-primary">
        {icon}
      </span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

/** Large, low-opacity leaf motif behind the invite hero — fills the flat
    background on wide screens without competing with the door reveal
    (which anchors on the setup card, mounted only after Get started). */
function HeroBackdrop() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 200"
      className="pointer-events-none absolute -top-24 -right-40 hidden h-[520px] w-[520px] text-accent opacity-[0.08] lg:block xl:-top-32 xl:-right-32 xl:h-[640px] xl:w-[640px]"
    >
      <path
        fill="currentColor"
        d="M100 10c49.7 0 90 40.3 90 90s-40.3 90-90 90S10 149.7 10 100 50.3 10 100 10Zm0 20c-20 25-30 47-30 70 0 27.6 22.4 50 50 50s50-22.4 50-50c0-23-10-45-30-70-13 12-20 24-20 38 0 8-4 12-10 12s-10-4-10-12c0-14-7-26-20-38Z"
      />
    </svg>
  );
}

/** Abstract, non-spoiler preview of a call in progress — deliberately no
    avatar art, since Luna's reveal is reserved for the door-open intro. */
function CallPreviewCard({ className }: { className?: string }) {
  return (
    <div className={cn(className)}>
      <div className="rounded-2xl border border-border/70 bg-card p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <PhoneCall className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">Kōsei Trading Co.</p>
            <p className="text-xs text-muted-foreground">Booking a delivery slot</p>
          </div>
          <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-accent">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" />
            Live
          </span>
        </div>

        <div className="mt-5 flex items-center justify-center gap-1 rounded-xl bg-muted/60 py-6 text-accent">
          <AudioLines className="size-8 opacity-80" />
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          Practice the whole call — greeting, the ask, the awkward part — before
          you dial the real one.
        </p>
      </div>
    </div>
  );
}
