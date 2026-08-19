import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Mic, Send, Sparkles } from "lucide-react";
import type { DocInput, GroundingAnswer, RoleId } from "@/shared/contract";
import type { ChatMessage } from "@/lib/llm";
import { useAppStore, type SetupStep } from "@/state/app-store";
import { useAvatar, type GuideLine } from "@/state/avatar-context";
import { useCatalog } from "@/hooks/use-catalog";
import { useGuideChat, type GuideChatState } from "@/hooks/use-guide-chat";
import { resolveDefaults } from "@/lib/presets";
import { DEFAULT_VOICE_ID } from "@/lib/presets";
import { CALL_ROLES } from "@/lib/coaching";
import { getScenario } from "@/lib/scenario-api";
import { pipeline } from "@/state/pipeline";
import { DocUpload } from "./DocUpload";
import { Grounding } from "./Grounding";
import { ScenarioPicker } from "./ScenarioPicker";
import { ReferenceSearch } from "./ReferenceSearch";
import { PastCalls } from "./PastCalls";
import { ChatBox, type ChatEntry } from "./ChatBox";
import { PerxonaBadge } from "@/components/brand/PerxonaBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const STEPS: { key: SetupStep; label: string }[] = [
  { key: "doc", label: "Document" },
  { key: "grounding", label: "Goal" },
  { key: "scenario", label: "Scenario" },
];

const INVITE_LINE = {
  en: "こんにちは! I'm Luna — your practice-call assistant. I'll help you talk to Japanese offices with confidence. Tap Get started when you're ready.",
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

/** Hold-to-talk mic that lets the user ask Luna a question on the main screen. */
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
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        // Capture the pointer so a drag off the button (common on touch)
        // still delivers pointerup/pointercancel HERE instead of wherever
        // the finger ends up — without capture, that release could land on
        // a different element and never call onStop, leaving the mic
        // recording with no way to stop it.
        e.currentTarget.setPointerCapture(e.pointerId);
        onStart();
      }}
      onPointerUp={onStop}
      onPointerCancel={onStop}
      disabled={!supported || thinking}
      className={cn(
        "flex select-none touch-none items-center justify-center gap-2 rounded-lg border font-semibold transition-colors",
        compact ? "px-3 py-2 text-xs" : "px-4 py-2.5 text-sm",
        listening
          ? "border-destructive/40 bg-destructive/15 text-destructive"
          : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25",
        (!supported || thinking) && "cursor-not-allowed opacity-50",
      )}
    >
      {thinking ? (
        <Loader2 className={cn("animate-spin", compact ? "size-3.5" : "size-4")} />
      ) : listening ? (
        <span className="size-2 animate-pulse rounded-full bg-destructive" />
      ) : (
        <Mic className={compact ? "size-3.5" : "size-4"} />
      )}
      {listening
        ? "Listening… release to ask"
        : thinking
          ? "Luna is thinking…"
          : compact
            ? "Talk to Luna"
            : "Hold to talk to Luna"}
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
          placeholder="Ask Luna… or hold the mic"
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
  const { session, unlockAudio, showGuide, speakGuide, startEager, stopEager } = useAvatar();

  /* Persistent chat transcript — the comic bubble is transient, this never
     loses a line. Every guide line (spoken or not) and every user turn lands here. */
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const appendChat = useCallback((entry: ChatEntry) => {
    setChat((prev) => [...prev, entry]);
  }, []);
  const handleShowGuide = useCallback(
    (line: GuideLine) => {
      showGuide(line);
      appendChat({ role: "luna", text: line.en });
    },
    [showGuide, appendChat],
  );
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
  const sendChat = useCallback(
    (text: string) => {
      appendChat({ role: "user", text });
      guideChat.sendText(text);
    },
    [appendChat, guideChat],
  );
  const [analyzing, setAnalyzing] = useState(false);
  const launchedRef = useRef(false);
  const lastGuideStepRef = useRef<SetupStep | null>(null);
  // Guards the invite line below against duplicate appends — the effect
  // re-runs (StrictMode double-invoke, or any identity change on
  // handleShowGuide/startEager/stopEager) every time `!setupOpen`, and used
  // to append INVITE_LINE to `chat` again on each re-run.
  const invitedRef = useRef(false);

  /* Launch the guide avatar (Luna / cc051_meeks by default) once the catalog is ready so
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
     Before Get started, Luna does NOT speak — eager gestures only. */
  useEffect(() => {
    if (!setupOpen) {
      if (!invitedRef.current) {
        invitedRef.current = true;
        handleShowGuide(INVITE_LINE);
      }
      startEager();
      return () => stopEager();
    }
    stopEager();
    if (state.setupStep === lastGuideStepRef.current) return;
    lastGuideStepRef.current = state.setupStep;
    handleSpeakGuide(GUIDES[state.setupStep]);
  }, [setupOpen, state.setupStep, handleShowGuide, handleSpeakGuide, startEager, stopEager]);

  useEffect(() => {
    /* Bounce back to the doc step only if nothing has been parsed yet. `docSummary`
       is set by PARSED (the store's `doc` field is unused by the parse flow). */
    if (!state.docSummary && state.setupStep !== "doc") setSetupStep("doc");
  }, [state.docSummary, state.setupStep, setSetupStep]);

  const handleGetStarted = useCallback(() => {
    setSetupOpen(true);
    /* This click is a user gesture — enable audio. The guide effect speaks the
       doc step line; unlockAudio itself never speaks. */
    void unlockAudio().catch(() => {});
  }, [setSetupOpen, unlockAudio]);

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

  const stepIndex = useMemo(
    () => STEPS.findIndex((s) => s.key === state.setupStep),
    [state.setupStep],
  );

  /* Invite state — the avatar is on screen in a portrait card with a Get
     started trigger, right-aligned to mirror the setup panel. */
  if (!setupOpen) {
    return (
      <div className="flex min-h-svh items-center justify-end px-4 py-6 pr-4 md:pr-8">
        <div className="flex w-[420px] max-w-[calc(100vw-2rem)] flex-col items-center gap-3">
          <Button
            size="lg"
            onClick={handleGetStarted}
            className="gap-2 px-8 py-6 text-lg shadow-xl"
          >
            <Sparkles className="size-5" />
            Get started
          </Button>
          <p className="text-sm text-muted-foreground">
            Meet Luna — your practice-call assistant.
          </p>
          <LunaChatPanel
            messages={chat}
            state={guideChat.state}
            supported={guideChat.supported}
            onStart={() => void guideChat.start()}
            onStop={() => void guideChat.stop()}
            onSend={sendChat}
          />
          {guideChat.error && (
            <p className="max-w-xs text-center text-xs text-destructive">{guideChat.error}</p>
          )}
          <PerxonaBadge />
        </div>
      </div>
    );
  }

  /* Setup pop-up — compact panel, at most ~25% of the screen. */
  return (
    <div className="flex min-h-svh items-center justify-end px-4 py-6 pr-4 md:pr-8">
      <div className="w-[420px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl border bg-card/90 p-5 shadow-xl backdrop-blur-md sm:p-6 max-h-[calc(100svh-3rem)]">
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
