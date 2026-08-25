/**
 * TagTeam shared contract.
 *
 * This file is COORDINATOR-OWNED. It is the single source of truth for the
 * data shapes that cross module boundaries (AI pipeline -> player -> UI).
 * Agents MUST import these types and MUST NOT edit this file.
 *
 * Flow: DocInput -> GroundingQuestion(s) -> SimScript + GlossaryEntry[]
 *   -> ScriptPlayer (per-turn present) -> CheatSheet
 */

/** Document input for the MVP: a photo, a set of scanned pages, or a
 *  free-text description of the issue. */
export type DocInput =
  | { kind: "image"; dataUrl: string; mimeType: string }
  | { kind: "images"; images: ImageDoc[] }
  | { kind: "text"; text: string };

/** The single-photo variant of {@link DocInput}. */
export type ImageDoc = Extract<DocInput, { kind: "image" }>;

/** Multi-page variant of {@link DocInput} (scanned document bundle). */
export type ImagesDoc = Extract<DocInput, { kind: "images" }>;

/** A single English grounding question the AI asks to establish call objective. */
export type GroundingQuestion = {
  id: string;
  question: string;
  options?: string[];
};

export type GroundingAnswer = {
  questionId: string;
  answer: string;
};

/** -- Simulation script --------------------------------------------------- */

export type Speaker = "bureaucrat" | "user";

/**
 * Emotional tone of a turn — passed to `present(text, { emotion, intensity })`
 * and drives Perxona facial-expression selection. Mirrors the platform's
 * PresentationEmotion values.
 */
export type TurnEmotion =
  | "joy"
  | "excitement"
  | "admiration"
  | "caring"
  | "gratitude"
  | "sadness"
  | "disappointment"
  | "annoyance"
  | "embarrassment"
  | "curiosity"
  | "surprise"
  | "realization"
  | "confusion";

/** Strength of the emotional tone. */
export type TurnIntensity = "low" | "neutral" | "high";

/** One exchange in the simulated call. */
export type Turn = {
  id: string;
  speaker: Speaker;
  /** Japanese spoken by the avatar (bureaucrat) or the user's expected line (user). */
  jp: string;
  /** English gloss, shown in the UI for orientation. */
  en?: string;
  /** ids into the glossary shown as active for this turn. */
  vocab: string[];
  /** optional Perxona motion markup, e.g. "[MOTION id:1]". */
  motion?: string;
  /** optional emotional tone for the bureaucrat line (avatar facial expression). */
  emotion?: TurnEmotion;
  intensity?: TurnIntensity;
};

export type SimScript = {
  scenarioTitle: string;
  turns: Turn[];
};

/** -- Glossary ------------------------------------------------------------ */

export type GlossaryEntry = {
  id: string;
  kanji: string;
  furigana: string;
  en: string;
  /** situational tip shown by Tap Help; optional. */
  note?: string;
};

export type TapHelp = {
  entryId: string;
  hint: string;
};

/** Verbal breakdown shown/played while the simulation is HELD. */
export type HoldHelp = {
  /** spoken by the avatar while paused. */
  explanationJp: string;
  /** shown in the UI while paused. */
  explanationEn: string;
};

/** -- Post-call cheat sheet ------------------------------------------------ */

export type CheatSheetPhrase = {
  jp: string;
  furigana: string;
  en: string;
  /** "when" trigger, e.g. "if they ask for your ID number". */
  when: string;
};

export type CheatSheet = {
  goal: string;
  keyPhrases: CheatSheetPhrase[];
  practice: string[];
  /** Office rules the caller should know before the real call (optional). */
  targetRules?: TargetRule[];
};

/**
 * One extracted rule about the target office (hours, booking, required docs…),
 * each with a citation so the learner can verify it. Phase 4 — target-specific
 * grounding surfaced in the cheat sheet.
 */
export type TargetRule = {
  id: string;
  rule: string;
  source: string;
  kind: "hours" | "booking" | "required_docs" | "cancellation" | "fees" | "notes";
};

/* -- Sprint 0 (Switchboard Plan): scenario module / vocab-pack content ----- */

/** Voice register a scenario module/vocab-pack line is authored for. A
 *  separate literal union from `src/lib/sim-engine.ts`'s `VoicePresetId`
 *  (same three ids) rather than an import — contract.ts is the
 *  coordinator-owned shared surface and sim-engine.ts is client-only; keep
 *  the two in sync if a preset is ever added or renamed. */
export type ScenarioVoicePreset = "formal" | "standard" | "friendly";

/**
 * One cross-cutting module line (MOD 1-6 — greeting, identity check, hold
 * filler, scheduling, closing, cancel/reschedule) — a fixed, native-checked
 * line reused across every department instead of being regenerated per call.
 * `audioAssetId` is set once the offline render pipeline
 * (`server/scenario-audio.mjs`) has produced a clip for this exact
 * (id, voicePreset) pair; absent until then, in which case the line is still
 * spoken, just via live TTS/Perxona instead of a prebuilt clip.
 */
export type ScenarioModuleLine = {
  /** e.g. "mod1.greeting", "mod6.cancel.confirm" — stable across re-renders. */
  id: string;
  voicePreset: ScenarioVoicePreset;
  jp: string;
  en?: string;
  audioAssetId?: string;
};

/**
 * A taxonomy leaf's prebuilt vocabulary (server/scenario-taxonomy.mjs; the
 * Switchboard Plan §03's "prebuild" column) — same entry shape a generated
 * script's glossary already uses, so nothing downstream has to special-case
 * where an entry came from.
 */
export type VocabPack = {
  /** Matches a scenario-taxonomy leaf id, e.g. "appt.doctor_dentist". */
  leafId: string;
  entries: GlossaryEntry[];
};

/* -- Phase 4: coaching settings (roles, difficulty, pace) ------------------ */

/** The office role the practice avatar plays (feeds the LLM persona). */
export type RoleId = "reception" | "claims" | "account";

/** Practice difficulty — drives how the bureaucrat speaks (keigo/vocab). */
export type CallDifficulty = "beginner" | "intermediate" | "advanced";

/** Conversation pace — drives turn length + rhythm of the bureaucrat lines. */
export type CallPace = "slow" | "normal" | "fast";

/**
 * Coaching preferences for a call, chosen in the scenario step and threaded
 * into BOTH script generation (client) and the adaptive nextTurn brain (server).
 * The persona data behind these lives in `src/shared/coaching.json`.
 */
export type CallSettings = {
  role: RoleId;
  difficulty: CallDifficulty;
  pace: CallPace;
};

/** -- Script player (owned by connect-core, consumed by UI) ---------------- */

export type PlayerState = "idle" | "talking" | "held" | "ended";

export type ScriptPlayerEvents = {
  /** raw text of the sentence currently being spoken (wired to PLAYING_SPEECH_TEXT). */
  onSpeakingText?: (text: string) => void;
  /** fired when a new turn becomes active. */
  onTurn?: (turn: Turn) => void;
  onState?: (state: PlayerState) => void;
};

/**
 * Drives the avatar through a SimScript one turn at a time.
 *
 * Pause semantics: the SDK has NO pause API, so "hold" pauses at the next
 * turn boundary — the player simply stops advancing the queue. The verbal
 * breakdown is a normal present() of HoldHelp.explanationJp.
 */
export interface ScriptPlayerHandle {
  load(script: SimScript, glossary: GlossaryEntry[]): void;
  /** start auto-advancing through turns. */
  play(): void;
  /** pause at the next turn boundary and return a verbal breakdown. */
  hold(): Promise<HoldHelp>;
  resume(): void;
  /** non-pausing hint for a glossary entry. Returns null if unknown. */
  tapHelp(entryId: string): TapHelp | null;
  /** interrupt the current presentation and reset to idle. */
  interrupt(): void;
  setEvents(events: ScriptPlayerEvents): void;
  getState(): PlayerState;
}

/* -- Phase 2: multi-device sessions (WebSocket hub + QR pairing) ----------- */

/** What a device can do. A device may hold several capabilities. */
export type DeviceCapability = "stage" | "input" | "control";

/** One connected (or last-known) device in a session. */
export type DeviceInfo = {
  deviceId: string;
  capabilities: DeviceCapability[];
  connected: boolean;
};

/** Coarse app state, broadcast to companion devices. */
export type AppStatus = "setup" | "ready" | "running" | "held" | "ended";

/**
 * Server-authoritative snapshot of the app, broadcast to companion devices on
 * every meaningful change (screen, setup step, player state, active turn).
 * Companion phones render this + send {@link ControlAction}s back.
 */
export type AppSnapshot = {
  sessionId: string;
  status: AppStatus;
  screen: string;
  setupStep?: string;
  summary?: string;
  scriptTitle?: string;
  playerState?: PlayerState;
  activeTurn?: Turn;
  /** Phase 3 — real-conversation brain state (thinking while the reply is generated). */
  callPhase?: CallPhase;
  /** Phase 5e — glossary entries for `activeTurn`, so companion devices can
   *  render vocab chips + tap-help without holding the full glossary. */
  activeVocab?: GlossaryEntry[];
  /** Phase 7b — background job runner status, derived server-side from job
   *  state; additive, so legacy clients ignoring it still see `callPhase`. */
  run?: RunSnapshot;
  /** Conversation-first setup — Luna's latest spoken line, so companion
   *  devices can follow the persona dialogue without the full transcript. */
  lunaLine?: string;
};

/** Control surface actions a companion device can trigger on the stage. */
export type ControlAction = "hold" | "resume" | "tapHelp";

/**
 * Phase 3 — real-conversation brain state, broadcast so every device (incl. the
 * stage's avatar) can mirror "listening" / "thinking". `idle` = not processing.
 */
export type CallPhase = "idle" | "thinking";

/* -- Phase 7b: background job runner (foreground/background split) -------- */

/**
 * A node in the server-side step graph (server/graph.mjs). The graph — not
 * the LLM — decides what runs next; classifyIntent (server/intent.mjs) only
 * ever returns one schema-validated JSON object, never a free tool call.
 */
export type JobStep =
  | "classifyIntent"
  | "parseDocument"
  | "identifyTarget"
  | "geolocate"
  | "research"
  | "scrape"
  | "extractTargetRules"
  | "confirmTarget"
  | "planScenario"
  | "cheatSheet";

export type JobStatus =
  | "queued"
  | "running"
  | "needs_input"
  | "done"
  | "failed"
  | "canceled"
  | "superseded";

/** Machine step + human-readable progress, streamed for the status feed. */
export type JobSnapshot = {
  id: string;
  step: JobStep;
  status: JobStatus;
  label: string;
  detail?: string;
  progress?: number;
  elapsedMs?: number;
  error?: { message: string; code?: string };
};

/** One candidate target office/agency surfaced by research, for the user to
 *  confirm or reject before anything downstream treats it as fact. */
export type TargetCandidate = {
  id: string;
  name: string;
  url?: string;
  address?: string;
  snippet?: string;
  /** How research found it. "user-url" = the user pasted that link and it
   *  was scraped directly — the confirmTarget gate auto-confirms those (a
   *  user's own URL is not a guess). Absent on legacy results = search. */
  via?: "search" | "user-url";
};

/**
 * `confirmTarget` pauses here — a resumable pause, not a re-run — until the
 * client sends `confirm`. `guessId` is the top candidate a speculative
 * subtree may already be working on (quarantined; never used as fact until
 * confirmed) — see the Phase 7 plan §7b.3.
 */
export type JobGate = {
  nodeId: "confirmTarget";
  candidates: TargetCandidate[];
  guessId?: string;
};

/** The confirmed target office, once `extractTargetRules` completes. */
export type TargetProfile = {
  name: string;
  url?: string;
  address?: string;
  rules: TargetRule[];
};

/** The `parseDocument` step's input, carried by a run's context — uploadId(s)
 *  already in the server's ephemeral upload store, or a text description.
 *  The image bytes themselves never enter the graph context. */
export type RunDoc =
  | { kind: "text"; text: string }
  | { kind: "image"; uploadId: string; mimeType?: string }
  | { kind: "images"; uploadIds: string[] };

/** Setup-screen state seeded into a run's ctx — the fields no graph node
 *  produces (see `startRun`'s `extra` in server/graph.mjs). Rides the
 *  `intent` message when the user states their objective. */
export type RunContext = {
  doc?: RunDoc;
  answers?: GroundingAnswer[];
  settings?: CallSettings;
  /** Voice preset key for the practice partner (server/prompts/bureaucrat.mjs). */
  preset?: string;
  /** Client-side DocSummary (src/lib/doc-parser.ts) fallback for when
   *  parseDocument doesn't run or fails. Duck-typed server-side. */
  docSummary?: Record<string, unknown>;
};

/** The run's deliverable once its deliver steps complete — planScenario's
 *  script + glossary plus the confirmed target, and (once the speculative
 *  cheatSheet node finishes, §7b.5 step 7) the ready-made cheat sheet. */
export type RunResult = {
  /** The latest deliver step to complete ("planScenario" or "cheatSheet"). */
  step: JobStep;
  script: SimScript;
  glossary: GlossaryEntry[];
  target?: TargetProfile | null;
  /** Present once the speculative cheatSheet node completes during the call. */
  cheatSheet?: CheatSheet | null;
};

export type RunSnapshot = {
  runId: string;
  goal: string;
  jobs: JobSnapshot[];
  gate?: JobGate;
  /** Present once a run's deliver steps (planScenario, then cheatSheet)
   *  complete; fields accumulate as each lands. */
  result?: RunResult;
};

/* -- Conversation-first setup (persona chat dispatches, Gemma executes) ---- */

/**
 * The server's classification of one free-text persona-chat turn
 * (server/intent.mjs). Broadcast back so the avatar can speak the matching
 * dialogue — confirming the search candidate, acking a URL, asking to repeat —
 * while the background run does the actual work. The model classifies; the
 * avatar talks; neither chooses what runs.
 */
export type ClassifiedIntent = {
  intent: "state_objective" | "provide_url" | "confirm" | "reject" | "question" | "other";
  /** The extracted entity to search for (Workflow 1's search candidate). */
  targetName?: string;
  url?: string;
  city?: string;
  objective?: string;
  confidence?: number;
};

/** Client → server WebSocket messages (mirrors docs/architecture.md §9). */
export type WsClientMessage =
  | {
      type: "join";
      /** Optional when only the 6-char pairing code is known (manual entry). */
      sessionId?: string;
      pairingToken: string;
      capabilities: DeviceCapability[];
    }
  | { type: "state"; snapshot: AppSnapshot }
  | { type: "control"; action: ControlAction; entryId?: string }
  | { type: "upload"; uploadId: string; filename: string }
  | { type: "ack"; uploadId: string }
  | {
      /**
       * Phase 3 — push-to-talk audio. The mic bytes were POSTed to `/api/audio`
       * (ephemeral store) first; `audioId` is the store reference. The hub runs
       * STT → nextTurn and broadcasts the resulting turns back.
       */
      type: "audio";
      audioId: string;
      mimeType?: string;
    }
  | { type: "ping" }
  | {
      /** Phase 7b — free-text turn, classified server-side (server/intent.mjs)
       *  into a fixed action; the model classifies, it never chooses.
       *  `context` seeds the run's ctx when the text states an objective
       *  (setup-screen document/answers/settings — see RunContext). */
      type: "intent";
      text: string;
      context?: RunContext;
    }
  | {
      /** Resolve an open gate. `candidateId: null` = none of these match. */
      type: "confirm";
      runId: string;
      candidateId: string | null;
    }
  | { type: "cancelRun"; runId: string };

/** Server → client WebSocket messages. */
export type WsServerMessage =
  | {
      type: "joined";
      deviceId: string;
      roles: DeviceCapability[];
      snapshot: AppSnapshot | null;
    }
  | { type: "devices"; devices: DeviceInfo[] }
  | { type: "state"; snapshot: AppSnapshot }
  | { type: "control"; action: ControlAction; entryId?: string }
  | { type: "upload"; uploadId: string; filename: string }
  | { type: "ack"; uploadId: string }
  | {
      /**
       * Phase 3 — a new conversation turn from the orchestrator. Broadcast for
       * every turn (the user's transcribed utterance AND the bureaucrat reply);
       * the stage presents the bureaucrat turns, all devices render the transcript.
       */
      type: "turn";
      turn: Turn;
      /** True when the brain signals the call should wrap up. */
      end?: boolean;
    }
  | { type: "phase"; phase: CallPhase }
  | { type: "error"; code: string; message: string }
  /** Phase 7b — one job's status/progress changed (see JobSnapshot). */
  | { type: "job"; runId: string; job: JobSnapshot }
  /** Phase 7b — the full run snapshot, sent on every meaningful change and
   *  replayed to a device that joins mid-run. */
  | { type: "run"; run: RunSnapshot }
  /** Conversation-first setup — how a persona-chat turn was classified, so
   *  the avatar speaks the matching dialogue (candidate confirm, URL ack,
   *  repeat-ask). `runId` is set when the classification started/cancels a
   *  specific run. */
  | { type: "classified"; result: ClassifiedIntent; runId?: string };

/** REST shape for a created/looked-up app session (QR-able). */
export type SessionSummary = {
  id: string;
  status: string;
  pairingToken: string;
  /** ISO timestamp — after this the pairing code no longer joins. */
  pairingExpiresAt: string;
  /** Absolute URL a phone opens to join this session (QR payload). */
  joinUrl: string;
  /** WebSocket URL for this session's hub. */
  wsUrl: string;
  /** Number of currently-connected devices (excluding this one). */
  deviceCount: number;
};
