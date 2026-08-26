import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CallSettings,
  DocInput,
  GroundingAnswer,
  RunContext,
  RunSnapshot,
} from "@/shared/contract";
import type { DocSummary } from "@/lib/doc-parser";
import { streamSearchReference } from "@/lib/api";
import type { ChatMessage } from "@/lib/llm";
import type { GuideLine } from "@/state/avatar-context";
import { useGuideChat } from "@/hooks/use-guide-chat";
import { uploadPage } from "@/lib/session-api";
import type { ChatEntry } from "@/components/setup/ChatBox";
import type { ClassifiedListener } from "@/state/session-context";

/** Live status of the chat-triggered web search: what's being searched and
 *  what has been found so far, as a single updating line in the chat panel. */
export type ChatSearch = {
  query: string;
  hits: number;
  pagesRead: number;
  status: "searching" | "done" | "error";
};

export type UseSetupChatOptions = {
  stepLabel: string;
  summary: string | null;
  answers: GroundingAnswer[];
  settings: CallSettings;
  docSummary: DocSummary | null;
  doc: DocInput | null;
  speakGuide: (line: GuideLine | null) => void;
  setLunaLine: (line: string | null) => void;
  setThinking: (thinking: boolean) => void;
  isSpeaking: boolean;
  setReference: (digest: string) => void;
  run: RunSnapshot | null;
  sendIntent: (text: string, context?: RunContext) => void;
  cancelRun: (runId: string) => void;
  onClassified: (listener: ClassifiedListener) => () => void;
};

/** Luna's persona for the setup-screen mic chat. Short, warm, actionable.
 *  Task-first, NOT document-first: the user may have a letter, a URL, an
 *  address or just a photo of a sign. When they state their task she says she
 *  will search for it and asks for anything that could refine that search —
 *  EXCEPT a pasted link, which IS the source: she reads it, she doesn't
 *  search around it. */
const LUNA_GUIDE_SYSTEM: string = [
  "You are Luna, a friendly English-speaking guide inside the TagTeam app, which helps",
  "non-native residents prepare for Japanese bureaucracy phone calls. You appear during",
  "app setup, on the main screen.",
  "The user's task can be anything — a paper letter, a webpage URL, a street address, or a photo of a sign.",
  "Never assume they have a document, and never ask them to upload one.",
  "If the user shares a webpage URL, that page is the authoritative source: briefly say you will",
  "read that site now (e.g. \"Let me read the site.\") and do NOT say you will search for it and do",
  "NOT ask for more information — the link already answers that.",
  "Otherwise, when the user tells you their task, briefly acknowledge it. The app will then ask",
  "whether they want to research specific details or jump into generic practice — you don't need",
  "to ask this yourself, just acknowledge the task.",
  "Keep replies to 1-3 short, plain, warm, actionable sentences. No lists unless asked.",
  "Refer to the current setup step if relevant.",
  "Never invent specific office hours or rules — real facts come from searching, not guessing.",
  "Gently steer off-topic questions back to the task.",
].join(" ");

/** A message that is ONLY one or more links — same shape as intent.mjs's
 *  fast path. Bare URLs skip Luna's LLM guide turn entirely: the server's
 *  deterministic pipeline reads the page (readUrl + auto-confirm) and the
 *  scripted dialogue below answers instantly, instead of her generic
 *  "searching…" reply racing it 20-35s later. */
const BARE_URL_RE = /^https?:\/\/\S+$/i;

/* Classification queues behind Luna's guide-chat reply on the serialized
   homelab model (two back-to-back completions, measured ~20-35s), and when
   it fails outright the hub stays silent. If no `classified` broadcast lands
   within this window of a send — past the normal race, i.e. something
   actually went wrong — fall back to searching the raw text; an entity-keyed
   search supersedes it if classification lands later. */
const CLASSIFY_WATCHDOG_MS = 40_000;

/**
 * Owns everything behind the setup screen's persistent Luna chat: the
 * transcript, the voice/guide-chat wiring, chat-triggered web search, the
 * classification watchdog, and the conversation-first workflow state machine
 * (`candidate` confirm/reject + the confirmTarget gate's one-time prompt).
 * Extracted from SetupScreen.tsx so that component can stay focused on
 * composing + rendering.
 */
export function useSetupChat(options: UseSetupChatOptions) {
  const {
    stepLabel,
    summary,
    answers,
    settings,
    docSummary,
    doc,
    speakGuide,
    setLunaLine,
    setThinking,
    isSpeaking,
    setReference,
    run,
    sendIntent,
    cancelRun,
    onClassified,
  } = options;

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
      /* Mirror to companion devices so the phone follows the dialogue. */
      setLunaLine(line.en);
    },
    [speakGuide, appendChat, setLunaLine],
  );

  const buildGuideContext = useCallback(
    (transcript: string): ChatMessage[] => {
      const parts = [`Current setup step: ${stepLabel}.`];
      if (summary) parts.push(`Document summary: ${summary}.`);
      if (answers.length > 0) parts.push(`Grounding answers given: ${answers.length}.`);
      parts.push("", `The user said: ${transcript}`);
      return [
        { role: "system", content: LUNA_GUIDE_SYSTEM },
        { role: "user", content: parts.join("\n") },
      ];
    },
    [stepLabel, summary, answers.length],
  );
  const guideChat = useGuideChat({
    onReply: (reply) => handleSpeakGuide({ en: reply }),
    onThinkingChange: (thinking) => setThinking(thinking),
    onUserInput: (text) => appendChat({ role: "user", text }),
    buildContext: buildGuideContext,
    // Echo guard: don't listen while Luna is speaking.
    avatarSpeaking: isSpeaking,
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
    if (answers.length > 0) context.answers = answers;
    context.settings = settings;
    if (docSummary) context.docSummary = { ...docSummary };
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
  }, [answers, settings, docSummary, doc]);

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

  /* Classification watchdog — see CLASSIFY_WATCHDOG_MS above. */
  const lastClassifiedAtRef = useRef(0);
  const watchdogIdRef = useRef(0);
  const watchdogTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (watchdogTimerRef.current !== null) window.clearTimeout(watchdogTimerRef.current);
    },
    [],
  );
  const armClassifyWatchdog = useCallback(
    (text: string) => {
      const sentAt = Date.now();
      watchdogIdRef.current = sentAt;
      if (watchdogTimerRef.current !== null) window.clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = window.setTimeout(() => {
        watchdogTimerRef.current = null;
        // A newer send owns the watch now, or classification already landed.
        if (watchdogIdRef.current !== sentAt || lastClassifiedAtRef.current >= sentAt) return;
        startChatSearch(text);
      }, CLASSIFY_WATCHDOG_MS);
    },
    [startChatSearch],
  );

  const sendChat = useCallback(
    (text: string) => {
      appendChat({ role: "user", text });
      /* No client-side search here: the hub's classification extracts the
         entity first, and the chat search (plus the run's research) keys off
         that — searching the raw sentence flooded results with generic
         appointment guides. */
      armClassifyWatchdog(text);
      /* Server side: classify the turn; a stated objective starts a run
         seeded with the setup-screen context. Upload failures must not eat
         the message — fall back to an unseeded intent. */
      void buildRunContext()
        .then((context) => sendIntent(text, context))
        .catch(() => sendIntent(text));
      /* Client side: Luna's guide chat still answers questions and chatter —
         the hub only acts on the intents it owns (objective/confirm/reject).
         A bare URL is the exception: the deterministic URL pipeline handles
         it server-side and speaks for itself below — her LLM turn would only
         add a wrong "I'll search… share more info" line half a minute later. */
      if (!BARE_URL_RE.test(text.trim())) {
        guideChat.sendText(text);
      }
    },
    [appendChat, buildRunContext, sendIntent, guideChat, armClassifyWatchdog],
  );

  /* -- Conversation-first workflows (product spec §Workflows) --------------
     The server classifies each chat turn and broadcasts the result; Luna
     speaks the matching dialogue here while Gemma's background run does the
     actual work. Workflow 1 is spec-parallel: the run starts BEFORE she asks
     "Is that correct?", so a rejection cancels real in-flight work.

     `candidate` is the single source of truth; `candidateRef` is a pure
     derived mirror (kept in sync by the effect right below it) so the
     `onClassified` handler can read the latest value without re-subscribing
     on every `candidate` change — nothing else ever writes to the ref. */
  const [candidate, setCandidate] = useState<string | null>(null);
  const candidateRef = useRef<string | null>(null);
  useEffect(() => {
    candidateRef.current = candidate;
  }, [candidate]);

  useEffect(
    () =>
      onClassified(({ result, runId }) => {
        // Any classified broadcast disarms the raw-text watchdog.
        lastClassifiedAtRef.current = Date.now();
        switch (result.intent) {
          case "state_objective": {
            const name = result.targetName?.trim();
            if (name) {
              setCandidate(name);
              // Sprint 2 — don't start the search yet. Luna asks
              // "generic or specific?" and the run starts once the
              // user picks. The entity name is stashed for later.
            } else {
              setCandidate(null);
            }
            // Sprint 2 — ask the practice-mode question regardless of
            // whether we have a target name.
            handleSpeakGuide({
              en: name
                ? `Ok, I can look up “${name}” for specific details, or we can do a generic practice. Which do you prefer?`
                : "I can research specific details for this, or we can do a generic practice. Which do you prefer?",
            });
            break;
          }
          case "practice_choice": {
            // Sprint 2 — the run has started on the server. Clear the
            // candidate (the run's own confirmTarget gate handles site
            // selection if research was not skipped).
            setCandidate(null);
            if (result.practiceMode === "generic") {
              handleSpeakGuide({ en: "Ok, let's jump straight into practice." });
            } else {
              handleSpeakGuide({ en: "Ok, let me search for the details." });
            }
            break;
          }
          case "confirm":
            if (candidateRef.current) {
              setCandidate(null);
              handleSpeakGuide({ en: "Ok, let me search." });
            } else if (run?.gate) {
              handleSpeakGuide({ en: "Great, let me put your practice call together." });
            }
            break;
          case "reject":
            if (candidateRef.current) {
              if (runId) cancelRun(runId);
              setCandidate(null);
              handleSpeakGuide({
                en: "No problem. Can you repeat the name of the place? If you have a letter or screenshot you can also add it.",
              });
            }
            break;
          case "provide_url":
            /* The pasted page IS the source (readUrl scrapes it and the gate
               auto-confirms) — say so, don't promise a search. */
            handleSpeakGuide({ en: "Let me read the site." });
            break;
          default:
            break;
        }
      }),
    [onClassified, handleSpeakGuide, cancelRun, run?.gate],
  );

  /* Site selection (Workflow 1's final step): when the confirmTarget gate
     opens with research results, Luna reads out her best guess. Once per
     run+gate — the snapshot re-broadcasts on every job change. */
  const gate = run?.gate;
  const gateGuess = gate?.candidates.find((c) => c.id === gate.guessId) ?? gate?.candidates[0];
  const askedGateRef = useRef<string | null>(null);
  useEffect(() => {
    if (!run || !gate || !gateGuess) return;
    const key = `${run.runId}:${gate.nodeId}`;
    if (askedGateRef.current === key) return;
    askedGateRef.current = key;
    handleSpeakGuide({
      en: `I found “${gateGuess.name}”. Is that the right place? Pick it below, or just say yes.`,
    });
    // Primitive-only deps + the once-per-key ref guard; the snapshot
    // re-broadcasts on every job change and must not re-trigger her.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.runId, gate?.nodeId, gateGuess?.name, gateGuess?.id, handleSpeakGuide]);

  /** Candidate yes/no chips reuse the intent pipeline — bare "yes"/"no" is
   *  fast-pathed server-side because a candidate is pending there too. */
  const answerCandidate = useCallback(
    (answer: "yes" | "no") => void buildRunContext().then((c) => sendIntent(answer, c)).catch(() => sendIntent(answer)),
    [buildRunContext, sendIntent],
  );

  /* Ambient processing (product spec): while Gemma's background work runs —
     Luna's own LLM turn, the chat-triggered search, or any active run step —
     she should vocalize short fillers instead of sitting silent. */
  const lunaThinking = guideChat.state === "thinking";
  const gemmaBusy =
    lunaThinking ||
    chatSearch?.status === "searching" ||
    (!!run &&
      !run.result &&
      !run.gate &&
      run.jobs.some((j) => j.status === "queued" || j.status === "running"));

  return {
    chat,
    appendChat,
    handleSpeakGuide,
    guideChat,
    chatSearch,
    candidate,
    sendChat,
    answerCandidate,
    lunaThinking,
    gemmaBusy,
    buildRunContext,
  };
}
