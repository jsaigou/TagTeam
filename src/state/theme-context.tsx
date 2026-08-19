import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "tagteam.theme";

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

type ThemeContextValue = {
  theme: Theme;
  /** The resolved (effective) theme — always equals `theme` (no system mode). */
  resolved: Theme;
  setTheme: (theme: Theme) => void;
  cycleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** App theme (light / dark), persisted to localStorage and applied via the
 *  `.dark` class on <html>. Dark tokens live in index.css. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    applyTheme(readStoredTheme());
    return readStoredTheme();
  });

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const value = useMemo(
    () => ({ theme, resolved: theme, setTheme, cycleTheme }),
    [theme, setTheme, cycleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}