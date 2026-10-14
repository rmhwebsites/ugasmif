"use client";

// System / Light / Dark, all three visible at once (SPEC 11.4).
//
// This replaced a single icon in the header that cycled through the modes on
// each click: you could not see the options, or tell which was active, without
// clicking through them. Here every option is on screen and the current one is
// highlighted, and "System" — follow the device — is the default.
//
// Two placements, both bottom-left. On fund pages it sits in the sidebar
// footer, so it is also in the mobile drawer. Pages without a sidebar (login,
// onboarding, app admin) get the floating variant, which globals.css hides on
// any page that has the fund chrome so there is never a second copy.

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "@/components/providers/ThemeProvider";

const OPTIONS: { value: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { value: "auto", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeSelector({
  variant = "sidebar",
}: {
  variant?: "sidebar" | "floating";
}) {
  const { mode, setMode } = useTheme();
  const floating = variant === "floating";

  // Arrow keys move between options, as they do in any radio group.
  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = OPTIONS.findIndex((o) => o.value === mode);
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = OPTIONS[(i + step + OPTIONS.length) % OPTIONS.length];
    setMode(next.value);
    // Keep focus with the selection, so the next arrow press continues from it.
    const group = e.currentTarget;
    requestAnimationFrame(() =>
      group.querySelector<HTMLButtonElement>(`[data-mode="${next.value}"]`)?.focus()
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      onKeyDown={onKeyDown}
      className={
        floating
          ? "theme-floating fixed bottom-4 left-4 z-40 inline-flex rounded-xl border border-card-border bg-card-solid p-1 shadow-lg"
          : "flex w-full rounded-lg border border-card-border bg-highlight/50 p-0.5"
      }
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = mode === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            // Roving tabindex: one tab stop for the group, arrows within it.
            tabIndex={active ? 0 : -1}
            data-mode={value}
            onClick={() => setMode(value)}
            title={value === "auto" ? "Match your device" : `${label} theme`}
            className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${
              floating ? "p-2" : "flex-1 px-1.5 py-1.5"
            } ${
              active
                ? "bg-card-solid text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* The floating copy overlays page content, so it stays icons-only;
                the label is still there for screen readers. */}
            {floating ? <span className="sr-only">{label}</span> : <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
