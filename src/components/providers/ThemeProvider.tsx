"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type ThemeMode = "auto" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "smif-theme";
const THEME_COLORS: Record<ResolvedTheme, string> = {
  dark: "#0b0b0d",
  light: "#f8f6f2",
};

interface ThemeContextValue {
  /** User preference: follow the system, or an explicit choice */
  mode: ThemeMode;
  /** What is actually rendered right now */
  resolvedTheme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "auto",
  resolvedTheme: "dark",
  setMode: () => {},
});

function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
  // Keep the browser chrome / iOS status bar in sync
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", THEME_COLORS[resolved]);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("auto");
  // SSR renders dark; the inline script in layout.tsx applies the real
  // theme before first paint, and this state catches up on mount.
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("dark");

  // Hydrate preference from storage
  useEffect(() => {
    let stored: ThemeMode = "auto";
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "light" || raw === "dark" || raw === "auto") stored = raw;
    } catch {
      // storage unavailable — stay on auto
    }
    // Reading localStorage during render would break SSR hydration, so the
    // preference is hydrated once after mount (same pattern as next-themes).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModeState(stored);
  }, []);

  // Apply the theme; in auto mode, follow system changes live
  useEffect(() => {
    const apply = (resolved: ResolvedTheme) => {
      applyTheme(resolved);
      setResolvedTheme(resolved);
    };

    if (mode === "auto") {
      apply(systemTheme());
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const onChange = () => apply(systemTheme());
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }

    apply(mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // storage unavailable — preference lives for this session only
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
