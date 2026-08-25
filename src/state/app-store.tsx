import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  CallSettings,
  CheatSheet,
  DocInput,
  GlossaryEntry,
  GroundingAnswer,
  GroundingQuestion,
  SimScript,
  TargetProfile,
} from "@/shared/contract";
import type { DocSummary } from "@/lib/doc-parser";
import { DEFAULT_CALL_SETTINGS } from "@/lib/coaching";

export type Screen = "setup" | "prep" | "call" | "cheat-sheet";
export type SetupStep = "doc" | "grounding" | "scenario";
/** QA round — the Get Started door intro (draw → knock → open → wave). While
 *  running, AvatarStage reframes Luna into the centered doorway. */
export type IntroPhase = "idle" | "running";
export type ScenarioSelection = {
  avatarId: string;
  sceneId: string;
  voiceId: string;
};

/** Bulk payload to restore a saved scenario (Phase 5c) into the app state. */
export type ScenarioRestore = {
  id: string;
  summary: string | null;
  answers: GroundingAnswer[];
  reference: string | null;
  /** The confirmed target office/agency (Phase 7b's grounding graph) the
   *  script was written from, if this call went through it. */
  target: TargetProfile | null;
  settings: CallSettings;
  selection: ScenarioSelection;
  script: SimScript;
  glossary: GlossaryEntry[];
  cheatSheet: CheatSheet | null;
};

type AppState = {
  screen: Screen;
  setupStep: SetupStep;
  /** Setup panel is a pop-up the avatar invites the user to open. */
  setupOpen: boolean;
  introPhase: IntroPhase;
  doc: DocInput | null;
  summary: string | null;
  docSummary: DocSummary | null;
  questions: GroundingQuestion[];
  answers: GroundingAnswer[];
  script: SimScript | null;
  glossary: GlossaryEntry[];
  cheatSheet: CheatSheet | null;
  scenario: ScenarioSelection | null;
  /** Phase 4 — coaching preferences for the call (role/difficulty/pace). */
  settings: CallSettings;
  /** Phase 5c — id of the persisted scenario for this call, once saved. */
  scenarioId: string | null;
  /** Web-researched reference digest about the office/agency for the call. */
  reference: string | null;
  /** The confirmed target office/agency (Phase 7b's grounding graph), when
   *  this call went through it — carries the real, cited rules the script
   *  was written from, so the live call can be grounded in the SAME facts
   *  instead of the separate free-text `reference` digest. */
  target: TargetProfile | null;
  busy: boolean;
  error: string | null;
};

type Action =
  | { type: "SET_SCREEN"; screen: Screen }
  | { type: "SET_SETUP_STEP"; step: SetupStep }
  | { type: "SET_SETUP_OPEN"; open: boolean }
  | { type: "SET_INTRO_PHASE"; phase: IntroPhase }
  | { type: "DOC_UPLOADED"; doc: DocInput }
  | { type: "PARSED"; summary: string; doc: DocSummary; questions: GroundingQuestion[] }
  | { type: "ANSWERS_SAVED"; answers: GroundingAnswer[] }
  | { type: "SCENARIO_CHOSEN"; scenario: ScenarioSelection }
  | { type: "SETTINGS_CHANGED"; settings: Partial<CallSettings> }
  | { type: "SCENARIO_SAVED"; id: string }
  | { type: "SCENARIO_RESTORED"; payload: ScenarioRestore }
  | { type: "SIM_READY"; script: SimScript; glossary: GlossaryEntry[]; target?: TargetProfile | null }
  | { type: "CHEAT_SHEET_READY"; cheatSheet: CheatSheet }
  | { type: "REFERENCE_READY"; digest: string }
  | { type: "BUSY"; busy: boolean }
  | { type: "ERROR"; message: string | null }
  | { type: "RESET" };

const initialState: AppState = {
  screen: "setup",
  setupStep: "doc",
  setupOpen: false,
  introPhase: "idle",
  doc: null,
  summary: null,
  docSummary: null,
  questions: [],
  answers: [],
  script: null,
  glossary: [],
  cheatSheet: null,
  scenario: null,
  settings: DEFAULT_CALL_SETTINGS,
  scenarioId: null,
  reference: null,
  target: null,
  busy: false,
  error: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_SCREEN":
      return { ...state, screen: action.screen, error: null };
    case "SET_SETUP_STEP":
      return { ...state, setupStep: action.step, error: null };
    case "SET_SETUP_OPEN":
      return { ...state, setupOpen: action.open, error: null };
    case "SET_INTRO_PHASE":
      return { ...state, introPhase: action.phase };
    case "DOC_UPLOADED":
      return { ...state, doc: action.doc, error: null };
    case "PARSED":
      return {
        ...state,
        summary: action.summary,
        docSummary: action.doc,
        questions: action.questions,
        busy: false,
      };
    case "ANSWERS_SAVED":
      return { ...state, answers: action.answers, busy: false };
    case "SCENARIO_CHOSEN":
      return { ...state, scenario: action.scenario };
    case "SETTINGS_CHANGED":
      return { ...state, settings: { ...state.settings, ...action.settings } };
    case "SCENARIO_SAVED":
      return { ...state, scenarioId: action.id };
    case "SCENARIO_RESTORED":
      return {
        ...state,
        scenarioId: action.payload.id,
        summary: action.payload.summary,
        answers: action.payload.answers,
        reference: action.payload.reference,
        target: action.payload.target,
        settings: action.payload.settings,
        scenario: action.payload.selection,
        script: action.payload.script,
        glossary: action.payload.glossary,
        cheatSheet: action.payload.cheatSheet,
        setupStep: action.payload.cheatSheet ? "scenario" : state.setupStep,
      };
    case "SIM_READY":
      return {
        ...state,
        script: action.script,
        glossary: action.glossary,
        target: action.target ?? null,
        busy: false,
      };
    case "CHEAT_SHEET_READY":
      return { ...state, cheatSheet: action.cheatSheet, busy: false };
    case "REFERENCE_READY":
      return { ...state, reference: action.digest, busy: false };
    case "BUSY":
      return { ...state, busy: action.busy };
    case "ERROR":
      return { ...state, error: action.message, busy: false };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

type Store = {
  state: AppState;
  toSetup: () => void;
  setSetupStep: (step: SetupStep) => void;
  setSetupOpen: (open: boolean) => void;
  setIntroPhase: (phase: IntroPhase) => void;
  toCall: () => void;
  toPrep: () => void;
  toCheatSheet: () => void;
  reset: () => void;
  setDoc: (doc: DocInput) => void;
  parsed: (summary: string, doc: DocSummary, questions: GroundingQuestion[]) => void;
  saveAnswers: (answers: GroundingAnswer[]) => void;
  chooseScenario: (scenario: ScenarioSelection) => void;
  setSettings: (settings: Partial<CallSettings>) => void;
  setScenarioId: (id: string) => void;
  restoreScenario: (payload: ScenarioRestore) => void;
  setSim: (script: SimScript, glossary: GlossaryEntry[], target?: TargetProfile | null) => void;
  setCheatSheet: (cheatSheet: CheatSheet) => void;
  setReference: (digest: string) => void;
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
};

const AppStoreContext = createContext<Store | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const value = useMemo<Store>(
    () => ({
      state,
      toSetup: () => dispatch({ type: "SET_SCREEN", screen: "setup" }),
      setSetupStep: (step) => dispatch({ type: "SET_SETUP_STEP", step }),
      setSetupOpen: (open) => dispatch({ type: "SET_SETUP_OPEN", open }),
      setIntroPhase: (phase) => dispatch({ type: "SET_INTRO_PHASE", phase }),
      toCall: () => dispatch({ type: "SET_SCREEN", screen: "call" }),
      toPrep: () => dispatch({ type: "SET_SCREEN", screen: "prep" }),
      toCheatSheet: () => dispatch({ type: "SET_SCREEN", screen: "cheat-sheet" }),
      reset: () => dispatch({ type: "RESET" }),
      setDoc: (doc) => dispatch({ type: "DOC_UPLOADED", doc }),
      parsed: (summary, doc, questions) =>
        dispatch({ type: "PARSED", summary, doc, questions }),
      saveAnswers: (answers) => dispatch({ type: "ANSWERS_SAVED", answers }),
      chooseScenario: (scenario) => dispatch({ type: "SCENARIO_CHOSEN", scenario }),
      setSettings: (settings) => dispatch({ type: "SETTINGS_CHANGED", settings }),
      setScenarioId: (id) => dispatch({ type: "SCENARIO_SAVED", id }),
      restoreScenario: (payload) => dispatch({ type: "SCENARIO_RESTORED", payload }),
      setSim: (script, glossary, target) => dispatch({ type: "SIM_READY", script, glossary, target }),
      setCheatSheet: (cheatSheet) => dispatch({ type: "CHEAT_SHEET_READY", cheatSheet }),
      setReference: (digest) => dispatch({ type: "REFERENCE_READY", digest }),
      setBusy: (busy) => dispatch({ type: "BUSY", busy }),
      setError: (message) => dispatch({ type: "ERROR", message }),
    }),
    [state],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): Store {
  const store = useContext(AppStoreContext);
  if (!store) throw new Error("useAppStore must be used within AppStoreProvider");
  return store;
}
