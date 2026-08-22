import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Send, Sparkles } from "lucide-react";
import type { DocInput, GroundingAnswer, RoleId, RunContext } from "@/shared/contract";
import type { ChatMessage } from "@/lib/llm";
import { useAppStore, type SetupStep } from "@/state/app-store";
import { useAvatar, GREETING_WAVE_MOTION, type GuideLine } from "@/state/avatar-context";
import { useSession } from "@/state/session-context";
import { useCatalog } from "@/hooks/use-catalog";
import { useGuideChat, type GuideChatState } from "@/hooks/use-guide-chat";
import { resolveDefaults } from "@/lib/presets";
import { DEFAULT_VOICE_ID } from "@/lib/presets";
import { CALL_ROLES } from "@/lib/coaching";
import { getScenario } from "@/lib/scenario-api";
import { uploadPage } from "@/lib/session-api";
import { pipeline } from "@/state/pipeline";
import { DocUpload } from "./DocUpload";
import { Grounding } from "./Grounding";
import { ScenarioPicker } from "./ScenarioPicker";
import { ReferenceSearch } from "./ReferenceSearch";
import { PastCalls } from "./PastCalls";
import { ChatBox, type ChatEntry } from "./ChatBox";
import { RunStatus } from "./RunStatus";
import { DoorsIntro } from "./DoorsIntro";
import { PerxonaBadge } from "@/components/brand/PerxonaBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

/** Luna's line when the doors open on her (Get Started door reveal). */
const GREETING_LINE = {
  en: "こんにちは! I'm Luna — your practice-call assistant. Let's get your call ready!",
};

/** Luna's persona for the setup-screen mic chat. Short, warm, actionable. */
const LUNA_GUIDE_SYSTEM: string = [
  "You are Luna, a friendly English-speaking guide inside the TagTeam app, which helps",
  "non-native residents prepare for Japanese bureaucracy phone calls. You appear during",
  "app setup, on the main screen.",
  "Keep replies to 1-3 short, plain, warm, actionable sentences. No lists unless asked.",
  "Refer to the current setup step and the user's document if relevant.",
  "Never invent specific office hours or rules — if asked about a particular office, suggest",
  "researching it or asking the staff directly. Gently steer off-topic questions back to setup.",
].join(" ");

/** Resolve a stored role back to its curated avatar/scene/voice selection. */
function packToSelection(role: RoleId): { avatarId: string; sceneId: string; voiceId: string } | null {
  const pack = CALL_ROLES[role].pack;
  if (!pack?.avatarId || !pack.sceneId) return null;
  return { avatarId: pack.avatarId, sceneId: pack.sceneId, voiceId: pack.voiceId ?? DEFAULT_VOICE_ID };
}

/** Click-to-toggle mic (QA fix): the hold-to-talk version read as a dead
 *  button whenever it was tapped — a quick tap captured no audio and nothing
 *  visibly happened. Now the first tap starts listening, the second sends. */
function TalkToLunaButton({
  state,
  supported,
  onStart,
  onStop,
  compact,
}: {
  state: GuideChatState;
  supported: boolean;
  onStart: () => void;
  onStop: () => void;
  compact?: boolean;
}) {
  const thinking = state === "thinking";
  const listening = state === "listening";
  const disabled = !supported || thinking;
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        if (listening) {
          onStop();
        } else {
          onStart();
        }
      }}
      disabled={disabled}
      title={
        !supported
          ? "Microphone unavailable"
          : listening
            ? "Tap again to send"
            : undefined
      }
      className={cn(
        "flex select-none items-center justify-center gap-2 rounded-lg border font-semibold transition-colors",
        compact ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm",
        listening
          ? "border-destructive/40 bg-destructive/15 text-destructive"
          : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {thinking ? (
        <Loader2 className={cn("animate-spin", compact ? "size-3.5" : "size-4")} />
      ) : listening ? (
        <span className="size-2 animate-pulse rounded-full bg-destructive" />
      ) : (
        <Mic className={compact ? "size-3.5" : "size-4"} />
      )}
      {listening ? "Listening… tap to send" : thinking ? "Luna is thinking…" : "Talk to Luna"}
    </button>
  );
}

/** Persistent chat with Luna — transcript + text input + mic. The comic bubble
 *  is transient; this panel keeps every line. */
function LunaChatPanel({
  messages,
  state,
  supported,
  onStart,
  onStop,
  onSend,
}: {
  messages: ChatEntry[];
  state: GuideChatState;
  supported: boolean;
  onStart: () => void;
  onStop: () => void;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const thinking = state === "thinking";

  const submit = () => {
    const text = draft.trim();
    if (!text || thinking) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <ChatBox messages={messages} />
      <div className="flex items-end gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask Luna… or tap the mic"
          rows={1}
          className="min-h-9 resize-none"
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={!draft.trim() || thinking}
          aria-label="Send to Luna"
          title="Send"
        >
          <Send className="size-4" />
        </Button>
        <TalkToLunaButton
          state={state}
          supported={supported}
          onStart={onStart}
          onStop={onStop}
          compact
        />
      </div>
    </div>
  );
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
    toCall,
    toCheatSheet,
  } = useAppStore();
  const { setupOpen } = state;
  const catalog = useCatalog();
  const { session, unlockAudio, speakGuide } = useAvatar();
  /* Phase 7b slice 6 — the server-authoritative run: this screen's chat rides
     `sendIntent` (classify → maybe start a run), RunStatus renders the feed
     and gate, and the delivered scenario drops into the store below. */
  const { run, sendIntent } = useSession();

  /* Persistent chat transcript — the comic bubble is transient, this never
     loses a line. Every guide line (spoken or not) and every user turn lands
     here; §7c.4 — an exact repeat of the LAST line bumps its ×N counter
     instead of appending a duplicate bubble. */
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const appendChat = useCallback((entry: ChatEntry) => {
    setChat((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === entry.role && last.text === entry.text) {
        return [...prev.slice(0, -1), { ...last, count: (last.count ?? 1) + 1 }];
      }
      return [...prev, entry];
    });
  }, []);
  const handleSpeakGuide = useCallback(
    (line: GuideLine) => {
      speakGuide(line);
      appendChat({ role: "luna", text: line.en });
    },
    [speakGuide, appendChat],
  );

  /* Phase 6 follow-up — hold-to-talk mic so the user can ask Luna a question on
     the main screen. Replies are shown + spoken via the guide bubble. */
  const stepLabel = STEPS.find((s) => s.key === state.setupStep)?.label ?? state.setupStep;
  const buildGuideContext = useCallback(
    (transcript: string): ChatMessage[] => {
      const parts = [`Current setup step: ${stepLabel}.`];
      if (state.summary) parts.push(`Document summary: ${state.summary}.`);
      if (state.answers.length > 0) parts.push(`Grounding answers given: ${state.answers.length}.`);
      parts.push("", `The user said: ${transcript}`);
      return [
        { role: "system", content: LUNA_GUIDE_SYSTEM },
        { role: "user", content: parts.join("\n") },
      ];
    },
    [stepLabel, state.summary, state.answers.length],
  );
  const guideChat = useGuideChat({
    onReply: (reply) => handleSpeakGuide({ en: reply }),
    onThinkingChange: (thinking) => session.setThinking(thinking),
    onUserInput: (text) => appendChat({ role: "user", text }),
    buildContext: buildGuideContext,
    // Echo guard: don't listen while Luna is speaking. Only listen
    // hands-free once the setup panel is open (not on the pre-interaction
    // invite screen), same spirit as the in-call VAD window only running
    // once the call has started.
    avatarSpeaking: session.isSpeaking,
    voiceTalkEnabled: setupOpen,
  });
  /* Guide-chat failures (mic denied, STT/LLM errors, too-quick taps) land in
     the transcript itself — QA showed the small red inline text was missed,
     so nothing silently no-ops anymore. */
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!guideChat.error || lastErrorRef.current === guideChat.error) return;
    lastErrorRef.current = guideChat.error;
    appendChat({ role: "luna", text: guideChat.error });
  }, [guideChat.error, appendChat]);

  /* Run context seeding — the fields no graph node produces (see RunContext).
     Document pages are uploaded to the server's ephemeral store lazily on
     first objective and cached per DocInput identity, so restating the
     objective doesn't re-upload (and the parseDocument job dedups on the
     same uploadIds). */
  const uploadedDocRef = useRef<{ doc: DocInput; uploadIds: string[] } | null>(null);
  const buildRunContext = useCallback(async (): Promise<RunContext> => {
    const context: RunContext = {};
    if (state.answers.length > 0) context.answers = state.answers;
    context.settings = state.settings;
    if (state.docSummary) context.docSummary = { ...state.docSummary };
    const doc = state.doc;
    if (!doc) return context;
    if (doc.kind === "text") {
      context.doc = { kind: "text", text: doc.text };
      return context;
    }
    const pages = doc.kind === "images" ? doc.images : [doc];
    let uploadIds = uploadedDocRef.current?.doc === doc ? uploadedDocRef.current.uploadIds : null;
    if (!uploadIds) {
      uploadIds = [];
      for (const [i, page] of pages.entries()) {
        const { uploadId } = await uploadPage({
          filename: `doc-page-${i + 1}.jpg`,
          mimeType: page.mimeType,
          dataUrl: page.dataUrl,
        });
        uploadIds.push(uploadId);
      }
      uploadedDocRef.current = { doc, uploadIds };
    }
    context.doc =
      uploadIds.length === 1
        ? { kind: "image", uploadId: uploadIds[0], mimeType: pages[0].mimeType }
        : { kind: "images", uploadIds };
    return context;
  }, [state.answers, state.settings, state.docSummary, state.doc]);

  const sendChat = useCallback(
    (text: string) => {
      appendChat({ role: "user", text });
      /* Server side: classify the turn; a stated objective starts a run
         seeded with the setup-screen context. Upload failures must not eat
         the message — fall back to an unseeded intent. */
      void buildRunContext()
        .then((context) => sendIntent(text, context))
        .catch(() => sendIntent(text));
      /* Client side: Luna's guide chat still answers questions and chatter —
         the hub only acts on the intents it owns (objective/confirm/reject). */
      guideChat.sendText(text);
    },
    [appendChat, buildRunContext, sendIntent, guideChat],
  );
  const [analyzing, setAnalyzing] = useState(false);
  const launchedRef = useRef(false);
  const lastGuideStepRef = useRef<SetupStep | null>(null);

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

  /* Guide line per setup step while the panel is open. The invite screen has
     no avatar, chat, or mic anymore (QA round) — Luna first appears when the
     user presses Get started. */
  useEffect(() => {
    if (!setupOpen || state.setupStep === lastGuideStepRef.current) return;
    lastGuideStepRef.current = state.setupStep;
    handleSpeakGuide(GUIDES[state.setupStep]);
  }, [setupOpen, state.setupStep, handleSpeakGuide]);

  useEffect(() => {
    /* Bounce back to the doc step only if nothing has been parsed yet. `docSummary`
       is set by PARSED (the store's `doc` field is unused by the parse flow). */
    if (!state.docSummary && state.setupStep !== "doc") setSetupStep("doc");
  }, [state.docSummary, state.setupStep, setSetupStep]);

  const handleGetStarted = useCallback(() => {
    /* This click is a user gesture — enable audio (presenter speech + the
       knock SFX), then run the door intro. The setup panel opens when it
       finishes (or is skipped). */
    void unlockAudio().catch(() => {});
    void unlockSfx();
    setIntroPhase("running");
  }, [setIntroPhase, unlockAudio]);

  const handleIntroFinish = useCallback(
    (skip: boolean) => {
      /* A skip may land mid-greeting — don't let her keep talking over the
         panel. */
      if (skip) session.interrupt();
      setIntroPhase("idle");
      setSetupOpen(true);
    },
    [session, setIntroPhase, setSetupOpen],
  );

  const handleIntroReveal = useCallback(() => {
    void session.playMotion(GREETING_WAVE_MOTION).catch(() => {});
    handleSpeakGuide(GREETING_LINE);
  }, [session, handleSpeakGuide]);

  const analyzeDoc = useCallback(
    async (doc: DocInput) => {
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
    [setDoc, parsed, setBusy, setError, setSetupStep],
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
        toCall();
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
      toCall,
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
      .then(() => toCall())
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
    toCall,
  ]);

  /* Invite state — a clean hero (QA round): a short explainer + one prominent
     CTA. No avatar, chat, or mic here; the avatar lane reservations only
     apply once the setup panel is open. While the door intro runs the hero
     hides entirely so the doorway reveals Luna (stage z-0), not this copy. */
  if (!setupOpen) {
    return (
      <div
        className={cn(
          "flex min-h-svh flex-col items-center justify-center px-4 pb-16",
          state.introPhase === "running" && "invisible",
        )}
      >
        <div className="flex w-full max-w-xl flex-col items-center gap-5 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-primary sm:text-4xl">
            Practice your Japanese office calls
          </h1>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground">
            TagTeam rehearses phone calls with Japanese offices before you make
            them. Upload a letter, answer a few questions, and an AI avatar
            plays the staff member — practice the conversation, then walk in
            with a cheat sheet.
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
        {state.introPhase === "running" && (
          <DoorsIntro onFinish={handleIntroFinish} onReveal={handleIntroReveal} />
        )}
      </div>
    );
  }

  /* Setup pop-up — the dominant panel in the content lane (the avatar keeps
     the left lane; below md the panel stacks under the card). */
  return (
    <div className="flex min-h-svh flex-col items-center justify-start px-4 pb-6 pt-[21rem] md:flex-row md:items-center md:justify-center md:pl-[calc(3.5rem_+_min(36vmin,17rem))] md:pr-8 md:pt-6">
      <div className="w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card/90 p-5 shadow-xl backdrop-blur-md sm:p-6 max-h-[calc(100svh-22.5rem)] md:max-h-[calc(100svh-3rem)]">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold text-primary">How can I help?</h2>
            <p className="text-sm text-muted-foreground">
              Three quick steps, then we connect you with the ward office.
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
          onStart={() => void guideChat.start()}
          onStop={() => void guideChat.stop()}
          onSend={sendChat}
        />

        <div className="mt-3">
          <RunStatus />
        </div>

        <div className="mt-5">
          {state.setupStep === "doc" && (
            <div className="flex flex-col gap-4">
              <DocUpload onAnalyzed={analyzeDoc} busy={analyzing} />
            </div>
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
  );
}
