"use client";

// The options on a pitch's ballot as a set of radio cards, plus Abstain.
// Shared by the Vote card on the pitch page and the pop-up ballot, so both
// read the same way and post the same thing.

import { CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import {
  ABSTAIN,
  DEFAULT_NO,
  DEFAULT_YES,
  amountNote,
  type BallotOptionView,
  type BallotPick,
} from "@/lib/ballot";

export function BallotChoices({
  name,
  options,
  value,
  onChange,
  disabled = false,
}: {
  /** Radio group name; unique per ballot on the page. */
  name: string;
  options: BallotOptionView[];
  value: BallotPick | null;
  onChange: (pick: BallotPick) => void;
  disabled?: boolean;
}) {
  const rows = [
    ...options.map((o) => ({
      key: o.id,
      label: o.label,
      note: amountNote(o),
      Icon: o.kind === "approve" ? CheckCircle2 : XCircle,
      on:
        o.kind === "approve"
          ? "border-gain bg-gain/10 text-foreground"
          : "border-loss bg-loss/10 text-foreground",
      icon: o.kind === "approve" ? "text-gain" : "text-loss",
    })),
    {
      key: ABSTAIN,
      label: "Abstain",
      note: "counts toward turnout only",
      Icon: MinusCircle,
      on: "border-foreground/50 bg-foreground/10 text-foreground",
      icon: "text-muted",
    },
  ];

  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="sr-only">Your vote</legend>
      <div className="space-y-2">
        {rows.map((row) => {
          const checked = value === row.key;
          return (
            <label
              key={row.key}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                checked ? row.on : "border-input-border bg-input-bg hover:bg-highlight"
              } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                type="radio"
                name={name}
                value={row.key}
                checked={checked}
                onChange={() => onChange(row.key)}
                className="sr-only"
              />
              <row.Icon className={`h-4 w-4 shrink-0 ${row.icon}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{row.label}</span>
                {row.key === ABSTAIN && (
                  <span className="block text-xs text-muted">{row.note}</span>
                )}
              </span>
              {row.key !== ABSTAIN && row.note && (
                <span className="shrink-0 text-sm tabular-nums text-muted">{row.note}</span>
              )}
              {/* The radio itself, so the pick doesn't rest on color alone. */}
              <span
                aria-hidden
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                  checked ? "border-foreground" : "border-input-border"
                }`}
              >
                {checked && <span className="h-2 w-2 rounded-full bg-foreground" />}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export interface CastResult {
  ok: boolean;
  error?: string;
  /** The ballot changed under the voter (an option was removed). */
  stale?: boolean;
}

export async function castBallot(
  fund: string,
  pitchId: string,
  pick: BallotPick,
  comment?: string
): Promise<CastResult> {
  try {
    const res = await fetch(`/api/${fund}/pitches/${pitchId}/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(pick === ABSTAIN
          ? { choice: "abstain" }
          : pick === DEFAULT_YES
            ? { choice: "yes" }
            : pick === DEFAULT_NO
              ? { choice: "no" }
              : { option_id: pick }),
        comment: comment && comment.trim() !== "" ? comment.trim() : undefined,
      }),
    });
    const json: { error?: string } = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true };
    return {
      ok: false,
      stale: res.status === 409,
      error: json.error ?? "Your vote could not be saved. Try again.",
    };
  } catch {
    return { ok: false, error: "Network error: your vote was not saved. Try again." };
  }
}
