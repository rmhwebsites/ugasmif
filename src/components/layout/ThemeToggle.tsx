"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/components/providers/ThemeProvider";

const NEXT_MODE: Record<ThemeMode, ThemeMode> = {
  auto: "light",
  light: "dark",
  dark: "auto",
};

export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const Icon = mode === "auto" ? Monitor : mode === "light" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => setMode(NEXT_MODE[mode])}
      title={`Theme: ${mode} (click to change)`}
      className="cursor-pointer rounded-lg p-2 text-muted transition-colors hover:bg-highlight hover:text-foreground"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
