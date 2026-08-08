import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  CheatSheet,
  DocInput,
  GlossaryEntry,
  GroundingAnswer,
  GroundingQuestion,
  SimScript,
} from "@/shared/contract";
import type { DocSummary } from "@/lib/doc-parser";
import { DEFAULT_BACKGROUND } from "@/lib/backgrounds";

export type Screen = "setup" | "call" | "cheat-sheet";
export type SetupStep = "doc" | "grounding" | "scenario";
export type ScenarioSelection = {
  avatarId: string;
  sceneId: string;
  voiceId: string;
  /** Static background key (see src/lib/backgrounds.ts). Optional. */
  background?: string;
};

type AppState = {
  screen: Screen;
  setupStep: SetupStep;
  /** Setup panel is a pop-up the avatar invites the user to open. */
  setupOpen: boolean;
  doc: DocInput | null;
  summary: string | null;
  docSummary: DocSummary | null;
  questions: GroundingQuestion[];
  answers: GroundingAnswer[];
  script: SimScript | null;
  glossary: GlossaryEntry[];
  cheatSheet: CheatSheet | null;
  scenario: ScenarioSelection | null;
  background: string;
  /** Web-researched reference digest about the office/agency for the call. */
  reference: string | null;
  busy: boolean;
  error: string | null;
};

type Action =
  | { type: "SET_SCREEN"; screen: Screen }
  | { type: "SET_SETUP_STEP"; step: SetupStep }
  | { type: "SET_SETUP_OPEN"; open: boolean }
  | { type: "DOC_UPLOADED"; doc: DocInput }
  | { type: "PARSED"; summary: string; doc: DocSummary; questions: GroundingQuestion[] }
  | { type: "ANSWERS_SAVED"; answers: GroundingAnswer[] }
  | { type: "SCENARIO_CHOSEN"; scenario: ScenarioSelection }
  | { type: "SIM_READY"; script: SimScript; glossary: GlossaryEntry[] }
  | { type: "CHEAT_SHEET_READY"; cheatSheet: CheatSheet }
  | { type: "REFERENCE_READY"; digest: string }
  | { type: "BUSY"; busy: boolean }
  | { type: "ERROR"; message: string | null }
  | { type: "RESET" };

const initialState: AppState = {
  screen: "setup",
  setupStep: "doc",
  setupOpen: false,
  doc: null,
  summary: null,
  docSummary: null,
  questions: [],
  answers: [],
  script: null,
  glossary: [],
  cheatSheet: null,
  scenario: null,
  background: DEFAULT_BACKGROUND,
  reference: null,
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
      return {
        ...state,
        scenario: action.scenario,
        background: action.scenario.background ?? state.background,
      };
    case "SIM_READY":
      return { ...state, script: action.script, glossary: action.glossary, busy: false };
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
  toCall: () => void;
  toCheatSheet: () => void;
  reset: () => void;
  setDoc: (doc: DocInput) => void;
  parsed: (summary: string, doc: DocSummary, questions: GroundingQuestion[]) => void;
  saveAnswers: (answers: GroundingAnswer[]) => void;
  chooseScenario: (scenario: ScenarioSelection) => void;
  setSim: (script: SimScript, glossary: GlossaryEntry[]) => void;
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
      toCall: () => dispatch({ type: "SET_SCREEN", screen: "call" }),
      toCheatSheet: () => dispatch({ type: "SET_SCREEN", screen: "cheat-sheet" }),
      reset: () => dispatch({ type: "RESET" }),
      setDoc: (doc) => dispatch({ type: "DOC_UPLOADED", doc }),
      parsed: (summary, doc, questions) =>
        dispatch({ type: "PARSED", summary, doc, questions }),
      saveAnswers: (answers) => dispatch({ type: "ANSWERS_SAVED", answers }),
      chooseScenario: (scenario) => dispatch({ type: "SCENARIO_CHOSEN", scenario }),
      setSim: (script, glossary) => dispatch({ type: "SIM_READY", script, glossary }),
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
