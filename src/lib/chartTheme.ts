// Chart colors that can't come from CSS variables — lightweight-charts and
// Recharts tooltip styles take literal color strings, so charts read the
// resolved theme and rebuild when it changes.

import type { ResolvedTheme } from "@/components/providers/ThemeProvider";
import type { FundSlug } from "@/types/domain";

export interface ChartTheme {
  textColor: string;
  textColorSubtle: string;
  gridColor: string;
  borderColor: string;
  crosshairColor: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  accent: string;
  benchmark: string;
}

const ACCENTS: Record<FundSlug, { dark: string; light: string }> = {
  athena: { dark: "#ba0c2f", light: "#ba0c2f" },
  arch: { dark: "#ce9c5c", light: "#b58844" },
};

const DARK: Omit<ChartTheme, "accent" | "benchmark"> = {
  textColor: "rgba(242, 239, 234, 0.85)",
  textColorSubtle: "rgba(242, 239, 234, 0.4)",
  gridColor: "rgba(255, 255, 255, 0.05)",
  borderColor: "rgba(255, 255, 255, 0.1)",
  crosshairColor: "rgba(128, 130, 133, 0.4)",
  tooltipBg: "#141417",
  tooltipBorder: "rgba(255, 255, 255, 0.1)",
  tooltipText: "#f2efea",
};

const LIGHT: Omit<ChartTheme, "accent" | "benchmark"> = {
  textColor: "rgba(28, 27, 26, 0.85)",
  textColorSubtle: "rgba(28, 27, 26, 0.45)",
  gridColor: "rgba(28, 27, 26, 0.06)",
  borderColor: "rgba(28, 27, 26, 0.12)",
  crosshairColor: "rgba(128, 130, 133, 0.5)",
  tooltipBg: "#ffffff",
  tooltipBorder: "rgba(28, 27, 26, 0.15)",
  tooltipText: "#1c1b1a",
};

export function getChartTheme(
  resolved: ResolvedTheme,
  fund: FundSlug = "athena"
): ChartTheme {
  const base = resolved === "light" ? LIGHT : DARK;
  return {
    ...base,
    accent: ACCENTS[fund][resolved],
    benchmark: resolved === "light" ? "#808285" : "#9a9c9f",
  };
}

export const GAIN_COLOR = "#22c55e";
export const LOSS_COLOR = "#ef4444";
