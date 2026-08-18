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

/** Document input for the MVP: a photo, or a free-text description of the issue. */
export type DocInput =
  | { kind: "image"; dataUrl: string; mimeType: string }
  | { kind: "text"; text: string };

/** The photo variant of {@link DocInput}. */
export type ImageDoc = Extract<DocInput, { kind: "image" }>;

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
