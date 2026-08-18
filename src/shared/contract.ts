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
};

/** Control surface actions a companion device can trigger on the stage. */
export type ControlAction = "hold" | "resume" | "tapHelp";

/**
 * Phase 3 — real-conversation brain state, broadcast so every device (incl. the
 * stage's avatar) can mirror "listening" / "thinking". `idle` = not processing.
 */
export type CallPhase = "idle" | "thinking";

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
  | { type: "ping" };

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
  | { type: "error"; code: string; message: string };

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
