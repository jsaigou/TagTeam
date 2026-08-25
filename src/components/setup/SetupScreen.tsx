import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import type { DocInput, GroundingAnswer, RoleId } from "@/shared/contract";
import { useAppStore, type SetupStep } from "@/state/app-store";
import { useAvatar, GREETING_WAVE_MOTION } from "@/state/avatar-context";
import { useSession } from "@/state/session-context";
import { useCatalog } from "@/hooks/use-catalog";
import { useSetupChat } from "@/hooks/use-setup-chat";
import { resolveDefaults } from "@/lib/presets";
import { DEFAULT_VOICE_ID } from "@/lib/presets";
import { PANEL_HEADER_CLEAR, PANEL_TOP, setAvatarAnchor } from "@/lib/avatar-window";
import { CALL_ROLES } from "@/lib/coaching";
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

/** Resolve a stored role back to its curated avatar/scene/voice selection. */
function packToSelection(role: RoleId): { avatarId: string; sceneId: string; voiceId: string } | null {
  const pack = CALL_ROLES[role].pack;
  if (!pack?.avatarId || !pack.sceneId) return null;
  return { avatarId: pack.avatarId, sceneId: pack.sceneId, voiceId: pack.voiceId ?? DEFAULT_VOICE_ID };
}

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

  const handleScenario = useCallback(
    async (scenario: { avatarId: string; sceneId: string; voiceId: string }) => {
      chooseScenario(scenario);
      setBusy(true);
      /* Luna visibly "writes" the call while the LLM works. */
      session.setThinking(true);
      try {
        const result = await pipeline.runSim(
          state.summary,
          state.answers,
          state.docSummary,
          state.reference,
          state.settings,
        );
        setSim(result.script, result.glossary);
        await session.launch(scenario);
        toPrep();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate simulation");
      } finally {
        session.setThinking(false);
        setBusy(false);
      }
    },
    [
      chooseScenario,
      setBusy,
      setSim,
      toPrep,
      state.summary,
      state.answers,
      state.docSummary,
      state.reference,
      state.settings,
      session,
      setError,
    ],
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
     into the store, launch the practice avatar, and move to the call. The
     selection is the user's pick when they made one, else the configured
     role's curated pack (the intent path skips the ScenarioPicker).
     Once-per-runId: the snapshot re-broadcasts on every job change. */
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
    setSim(result.script, result.glossary);
    setBusy(true);
    session.setThinking(true);
    void session
      .launch(selection)
      .then(() => toPrep())
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : "Failed to launch the presenter."),
      )
      .finally(() => {
        session.setThinking(false);
        setBusy(false);
      });
  }, [
    run,
    state.scenario,
    state.settings.role,
    chooseScenario,
    setSim,
    setBusy,
    setError,
    session,
    toPrep,
  ]);

  /* Invite state — a clean hero (QA round): a short explainer + one prominent
     CTA. Get started opens the centered main UI and plays the corner door
     intro over it; the hero itself never coexists with the intro. */
  if (!setupOpen) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center px-4 pb-16">
        <div className="flex w-full max-w-xl flex-col items-center gap-5 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">
            Practice your Japanese office calls
          </h1>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">
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
        ref={(el) => {
          setAvatarAnchor(el);
        }}
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
              onChoose={handleScenario}
              busy={state.busy}
              avatars={catalog.avatars}
              scenes={catalog.scenes}
              voices={catalog.voices}
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
