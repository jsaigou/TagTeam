import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, Mic, SearchX, Send, Sparkles } from "lucide-react";
import type { DocInput, GroundingAnswer, RoleId, RunContext } from "@/shared/contract";
import { streamSearchReference } from "@/lib/api";
import type { ChatMessage } from "@/lib/llm";
import { useAppStore, type SetupStep } from "@/state/app-store";
import { useAvatar, GREETING_WAVE_MOTION, type GuideLine } from "@/state/avatar-context";
import { useSession } from "@/state/session-context";
import { useCatalog } from "@/hooks/use-catalog";
import { useGuideChat, type GuideChatState } from "@/hooks/use-guide-chat";
import { resolveDefaults } from "@/lib/presets";
import { DEFAULT_VOICE_ID } from "@/lib/presets";
import {
  AVATAR_WINDOW_RIGHT,
  AVATAR_WINDOW_SIZE,
  AVATAR_WINDOW_TOP,
  PANEL_HEADER_CLEAR,
  PANEL_TOP,
} from "@/lib/avatar-window";
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
  en: "Hi! I'm Luna — your practice-call assistant. Let's get your call ready!",
};

/** Luna's persona for the setup-screen mic chat. Short, warm, actionable.
 *  Task-first, NOT document-first: the user may have a letter, a URL, an
 *  address or just a photo of a sign. When they state their task she says she
 *  will search for it and asks for anything that could refine that search. */
const LUNA_GUIDE_SYSTEM: string = [
  "You are Luna, a friendly English-speaking guide inside the TagTeam app, which helps",
  "non-native residents prepare for Japanese bureaucracy phone calls. You appear during",
  "app setup, on the main screen.",
  "The user's task can be anything — a paper letter, a webpage URL, a street address, or a photo of a sign.",
  "Never assume they have a document, and never ask them to upload one.",
  "When the user tells you their task, briefly acknowledge it and say you will try searching for it now,",
  "then invite them to share any extra information — like a letter, webpage, address, or sign — that could help refine the search.",
  "Keep replies to 1-3 short, plain, warm, actionable sentences. No lists unless asked.",
  "Refer to the current setup step if relevant.",
  "Never invent specific office hours or rules — real facts come from searching, not guessing.",
  "Gently steer off-topic questions back to the task.",
].join(" ");

/** Resolve a stored role back to its curated avatar/scene/voice selection. */
function packToSelection(role: RoleId): { avatarId: string; sceneId: string; voiceId: string } | null {
  const pack = CALL_ROLES[role].pack;
  if (!pack?.avatarId || !pack.sceneId) return null;
  return { avatarId: pack.avatarId, sceneId: pack.sceneId, voiceId: pack.voiceId ?? DEFAULT_VOICE_ID };
}

/** The Talk button: tap once and just speak — a voice-activated (VAD) mic
 *  session opens, detects when you pause, and submits on its own. Tap again
 *  to stop. Active mode glows so it's obvious the mic is live. */
function TalkButton({
  state,
  supported,
  onStart,
  onStop,
}: {
  state: GuideChatState;
  supported: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const thinking = state === "thinking";
  const listening = state === "listening";
  const disabled = !supported || thinking;
  /* Active talk mode reads as a live, glowing control — bigger text plus a
     soft accent glow on both the button and its label. */
  const glow = listening
    ? {
        boxShadow:
          "0 0 18px 2px color-mix(in srgb, var(--accent) 55%, transparent), 0 0 4px 1px color-mix(in srgb, var(--accent) 40%, transparent)",
      }
    : undefined;
  const labelGlow = listening
    ? { textShadow: "0 0 10px color-mix(in srgb, var(--accent) 80%, transparent)" }
    : undefined;
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        if (state === "listening") {
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
            ? "Listening — tap to stop"
            : "Tap, then just speak"
      }
      style={glow}
      className={cn(
        "flex select-none items-center justify-center gap-2 rounded-lg border font-semibold transition-all",
        listening ? "px-5 py-3 text-base sm:text-lg" : "px-4 py-2.5 text-sm",
        listening
          ? "border-accent/60 bg-accent/20 text-accent"
          : "border-accent/40 bg-accent/15 text-accent hover:bg-accent/25",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {thinking ? (
        <Loader2 className="size-4 animate-spin" />
      ) : listening ? (
        <span className="size-3 animate-pulse rounded-full bg-destructive" />
      ) : (
        <Mic className="size-4" />
      )}
      <span style={labelGlow}>
        {listening ? "Listening…" : thinking ? "Luna is thinking…" : "Talk"}
      </span>
    </button>
  );
}

/** Live status of the chat-triggered web search: what's being searched and
 *  what has been found so far, as a single updating line in the chat panel. */
type ChatSearch = {
  query: string;
  hits: number;
  pagesRead: number;
  status: "searching" | "done" | "error";
};

function SearchStatusLine({ search }: { search: ChatSearch }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-xs",
        search.status === "error"
          ? "border-destructive/40 bg-destructive/5 text-destructive"
          : "border-accent/30 bg-accent/5 text-muted-foreground",
      )}
    >
      {search.status === "searching" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
      ) : search.status === "done" ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-accent" />
      ) : (
        <SearchX className="size-3.5 shrink-0" />
      )}
      <span>
        {search.status === "done"
          ? "Searched"
          : search.status === "error"
            ? "Search failed"
            : "Searching"}{" "}
        for <span className="font-medium text-foreground">“{search.query}”</span>
      </span>
      {search.hits > 0 && (
        <span className="text-accent">
          — {search.hits} result{search.hits === 1 ? "" : "s"} found
          {search.pagesRead > 0 ? `, ${search.pagesRead} page${search.pagesRead === 1 ? "" : "s"} read` : ""}
        </span>
      )}
    </div>
  );
}

/** Papers appearing one by one in front of Luna while she searches — the
 *  visual of her working through reference material. Purely decorative. */
function SearchPapersOverlay() {
  const papers = [
    { left: "12%", top: "18%", rot: "-14deg", delay: 0 },
    { left: "46%", top: "34%", rot: "9deg", delay: 0.4 },
    { left: "24%", top: "52%", rot: "-4deg", delay: 0.8 },
    { left: "56%", top: "12%", rot: "16deg", delay: 1.2 },
    { left: "38%", top: "64%", rot: "-20deg", delay: 1.6 },
  ];
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-30 overflow-hidden rounded-2xl"
      style={{
        top: AVATAR_WINDOW_TOP,
        right: AVATAR_WINDOW_RIGHT,
        width: AVATAR_WINDOW_SIZE,
        height: AVATAR_WINDOW_SIZE,
      }}
    >
      <style>{`
        @keyframes tt-paper-in {
          0% { opacity: 0; transform: translate(-80%, -130%) rotate(-50deg); }
          70% { opacity: 1; }
          100% { opacity: 1; transform: translate(0, 0) rotate(var(--rot)); }
        }
        @keyframes tt-paper-float {
          0%, 100% { transform: translate(0, 0) rotate(var(--rot)); }
          50% { transform: translate(0, -7px) rotate(calc(var(--rot) + 3deg)); }
        }
      `}</style>
      {papers.map((p, i) => (
        <div
          key={i}
          className="absolute rounded-[3px] shadow-md ring-1 ring-black/10"
          style={{
            left: p.left,
            top: p.top,
            width: "32%",
            height: "22%",
            ["--rot" as string]: p.rot,
            background:
              "linear-gradient(to bottom, #fff 0%, #f7f5f0 100%)",
            backgroundImage:
              "repeating-linear-gradient(to bottom, transparent 0 5px, rgba(0,0,0,.09) 5px 6px), linear-gradient(to bottom, #fff 0%, #f7f5f0 100%)",
            animation: `tt-paper-in .55s ease-out ${p.delay}s both, tt-paper-float 2.8s ease-in-out ${p.delay + 0.55}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

/** Persistent chat with Luna — transcript + text input + Talk mic. */
function LunaChatPanel({
  messages,
  state,
  supported,
  search,
  onStart,
  onStop,
  onSend,
}: {
  messages: ChatEntry[];
  state: GuideChatState;
  supported: boolean;
  search: ChatSearch | null;
  onStart: () => void;
  onStop: () => void;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    // Never gated on `thinking`: turns are queued server-side of the hook, so
    // messages typed while Luna thinks wait their turn instead of vanishing
    // (the old drop-on-busy read as a dead Send button).
    if (!text) return;
    onSend(text);
    setDraft("");
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <ChatBox messages={messages} />
      {search && <SearchStatusLine search={search} />}
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
          placeholder="Tell Luna your task… or tap Talk"
          rows={1}
          className="min-h-9 resize-none"
        />
        <Button
          size="icon"
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="Send to Luna"
          title="Send"
        >
          <Send className="size-4" />
        </Button>
        <TalkButton state={state} supported={supported} onStart={onStart} onStop={onStop} />
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
    setReference,
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
    // Echo guard: don't listen while Luna is speaking.
    avatarSpeaking: session.isSpeaking,
    // Pre-roll so the start of an utterance is never clipped.
    preRollMs: 700,
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

  /* Chat-triggered research: when the user tells Luna their task, she says
     she'll search for it — and we actually do, streaming hits/pages into a
     live status line in the chat panel while papers pile up in front of her.
     The digest lands in the app reference store so it grounds the scenario
     exactly like the manual Research step. */
  const [chatSearch, setChatSearch] = useState<ChatSearch | null>(null);
  const chatSearchCloseRef = useRef<(() => void) | null>(null);
  const startChatSearch = useCallback(
    (rawQuery: string) => {
      const query = rawQuery.trim();
      // Too short to be a meaningful search (e.g. "yes", "thanks").
      if (query.length < 6) return;
      chatSearchCloseRef.current?.();
      setChatSearch({ query, hits: 0, pagesRead: 0, status: "searching" });
      chatSearchCloseRef.current = streamSearchReference(query, {
        onHits: (_q, results) =>
          setChatSearch((s) => (s ? { ...s, hits: results.length } : s)),
        onPage: (event) =>
          setChatSearch((s) => (s ? { ...s, pagesRead: event.index } : s)),
        onDone: (result) => {
          setReference(result.digest);
          setChatSearch((s) => (s ? { ...s, status: "done" } : s));
        },
        onError: () => setChatSearch((s) => (s ? { ...s, status: "error" } : s)),
      });
    },
    [setReference],
  );
  useEffect(() => () => chatSearchCloseRef.current?.(), []);

  const sendChat = useCallback(
    (text: string) => {
      appendChat({ role: "user", text });
      startChatSearch(text);
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
    [appendChat, buildRunContext, sendIntent, guideChat, startChatSearch],
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

  /* Guide line per setup step while the panel is open. Dialogue stays silent
     until the door intro has fully faded (or been skipped) — Luna's greeting
     is the first thing you hear, then the per-step lines take over. */
  useEffect(() => {
    if (!setupOpen || state.introPhase !== "idle") return;
    if (state.setupStep === lastGuideStepRef.current) return;
    lastGuideStepRef.current = state.setupStep;
    handleSpeakGuide(GUIDES[state.setupStep]);
  }, [setupOpen, state.introPhase, state.setupStep, handleSpeakGuide]);

  useEffect(() => {
    /* Bounce back to the doc step only if nothing has been parsed yet. `docSummary`
       is set by PARSED (the store's `doc` field is unused by the parse flow). */
    if (!state.docSummary && state.setupStep !== "doc") setSetupStep("doc");
  }, [state.docSummary, state.setupStep, setSetupStep]);

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
      </div>
    );
  }

  /* Setup card — wide (~80% of the viewport) and starting high so Luna's
     corner window clips its top-right corner: she reads as part of the panel
     instead of floating in distant whitespace. Geometry comes from
     src/lib/avatar-window.ts (PANEL_TOP / PANEL_HEADER_CLEAR). */
  return (
    <>
      <div
        className="flex min-h-svh flex-col items-center justify-start px-4 pb-6"
        style={{ paddingTop: PANEL_TOP }}
      >
      <div className="w-full max-w-[80%] overflow-y-auto rounded-2xl border bg-card/90 p-5 shadow-xl backdrop-blur-md sm:p-6 max-h-[calc(100svh-16rem)]">
        {/* Header row keeps right of Luna's footprint while the card top is
            still under her window. */}
        <div
          className="flex flex-col gap-1.5"
          style={{ paddingRight: PANEL_HEADER_CLEAR }}
        >
          <div className="flex flex-col gap-1.5">
            <h2 className="text-xl font-semibold text-primary">Getting ready for your call</h2>
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
          search={chatSearch}
          onStart={() => guideChat.startVoice()}
          onStop={() => guideChat.stopVoice()}
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

      {/* Papers pile up in front of Luna while she researches the task. */}
      {chatSearch?.status === "searching" && <SearchPapersOverlay />}

      {/* The corner door reveal plays over the live, centered UI. */}
      {state.introPhase === "running" && (
        <DoorsIntro onFinish={handleIntroFinish} onReveal={handleIntroReveal} />
      )}
    </>
  );
}
