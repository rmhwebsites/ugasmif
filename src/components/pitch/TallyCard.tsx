// The tally for a pitch vote (SPEC Section 12). Presentational only, so
// both server pages (admin live tallies) and the client VotePanel can render
// it. Voter names + comments are passed only for callers that already hold
// can(ctx, "view_individual_votes") — this component never fetches.
//
// With ballot options (migration 0006) it shows a bar per option and one for
// abstentions; without them (votes closed before options existed, or a caller
// that only has the totals) it shows Yes and No as before. The headline is
// always the pass math: yes / (yes + no).

import { CheckCircle2, MinusCircle, Trophy, Users, XCircle } from "lucide-react";
import { formatDateTime, formatPercent } from "@/lib/format";
import { amountNote, type BallotOptionView } from "@/lib/ballot";
import type { VoteChoice } from "@/types/domain";

export interface TallyVoter {
  name: string;
  choice: VoteChoice;
  /** The option's label, when the ballot named one. */
  optionLabel?: string | null;
  comment: string | null;
  castAt: string;
}

export interface TallyOption extends BallotOptionView {
  count: number;
}

const CHOICE_ICON = {
  yes: { Icon: CheckCircle2, color: "text-gain" },
  no: { Icon: XCircle, color: "text-loss" },
  abstain: { Icon: MinusCircle, color: "text-muted" },
} as const;

export function TallyCard({
  yes,
  no,
  abstain = 0,
  eligible,
  thresholdPct,
  quorumPct = null,
  resultPct = null,
  outcome = null,
  live = false,
  myChoice = null,
  myOptionId = null,
  options = null,
  winningOptionId = null,
  voters = null,
  className = "",
}: {
  yes: number;
  no: number;
  abstain?: number;
  /** eligible_voters captured when the vote opened; null when unknown. */
  eligible: number | null;
  thresholdPct: number;
  quorumPct?: number | null;
  /** Stored result_pct at close; computed from yes/no when null. */
  resultPct?: number | null;
  /** Pass/fail badge for closed votes; null while open. */
  outcome?: "passed" | "failed" | null;
  live?: boolean;
  myChoice?: VoteChoice | null;
  myOptionId?: string | null;
  /** Per-option counts, in ballot order. Officer/advisor views only. */
  options?: TallyOption[] | null;
  /** The allocation that passed (or, while live, the one leading). */
  winningOptionId?: string | null;
  /** Officer/advisor-only voter roll; omit for members. */
  voters?: TallyVoter[] | null;
  className?: string;
}) {
  const sides = yes + no;
  const cast = sides + abstain;
  const pctYes = resultPct !== null ? Number(resultPct) : sides > 0 ? (yes / sides) * 100 : 0;
  // Bars are shares of every ballot in, so the rows add up to the whole.
  const share = (n: number) => (cast > 0 ? (n / cast) * 100 : 0);

  const rows =
    options && options.length > 0
      ? [
          ...options.map((o) => ({
            key: o.id,
            label: o.label,
            note: amountNote(o),
            count: o.count,
            ...CHOICE_ICON[o.kind === "approve" ? "yes" : "no"],
            bar: o.kind === "approve" ? "bg-gain" : "bg-loss",
            mine: myOptionId === o.id,
            winner: o.id === winningOptionId && o.kind === "approve",
          })),
          ...(abstain > 0 || myChoice === "abstain"
            ? [
                {
                  key: "abstain",
                  label: "Abstained",
                  note: null,
                  count: abstain,
                  ...CHOICE_ICON.abstain,
                  bar: "bg-muted",
                  mine: myChoice === "abstain",
                  winner: false,
                },
              ]
            : []),
        ]
      : [
          { key: "yes", label: "Yes", note: null, count: yes, ...CHOICE_ICON.yes, bar: "bg-gain", mine: myChoice === "yes", winner: false },
          { key: "no", label: "No", note: null, count: no, ...CHOICE_ICON.no, bar: "bg-loss", mine: myChoice === "no", winner: false },
          ...(abstain > 0 || myChoice === "abstain"
            ? [{ key: "abstain", label: "Abstained", note: null, count: abstain, ...CHOICE_ICON.abstain, bar: "bg-muted", mine: myChoice === "abstain", winner: false }]
            : []),
        ];

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {outcome !== null && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                outcome === "passed"
                  ? "bg-gain/15 text-gain"
                  : "bg-loss/15 text-loss"
              }`}
            >
              {outcome === "passed" ? "Passed" : "Failed"}
            </span>
          )}
          {live && (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <span className="h-2 w-2 animate-pulse rounded-full bg-gain" />
              Live
            </span>
          )}
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {formatPercent(pctYes)} yes
        </span>
      </div>

      <div className="space-y-4">
        {rows.map((row) => (
          <div key={row.key}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <row.Icon className={`h-4 w-4 shrink-0 ${row.color}`} aria-hidden />
                <span className="truncate text-sm font-medium">{row.label}</span>
                {row.note && (
                  <span className="shrink-0 text-xs tabular-nums text-muted">{row.note}</span>
                )}
                {row.mine && (
                  <span className="shrink-0 text-[10px] text-accent-text">(your vote)</span>
                )}
                {row.winner && (
                  <span
                    className="flex shrink-0 items-center gap-0.5 text-[10px] font-semibold text-gain"
                    title={outcome === "passed" ? "The allocation that passed" : "Leading allocation"}
                  >
                    <Trophy className="h-3 w-3" aria-hidden />
                    {outcome === "passed" ? "passed" : live ? "leading" : ""}
                  </span>
                )}
              </div>
              <span className={`shrink-0 text-sm font-semibold tabular-nums ${row.color}`}>
                {row.count}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-highlight">
              <div
                className={`h-full rounded-full transition-all duration-500 ${row.bar}`}
                style={{ width: `${share(row.count)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {cast} of {eligible ?? "?"} eligible voted
          {abstain > 0 ? ` (${abstain} abstained)` : ""}
        </span>
        <span>
          Needs ≥ {formatPercent(Number(thresholdPct))} yes
          {quorumPct !== null && quorumPct !== undefined
            ? ` and ${formatPercent(Number(quorumPct))} turnout`
            : ""}
        </span>
      </div>

      {voters !== null && voters !== undefined && voters.length > 0 && (
        <div className="mt-4 border-t border-card-border pt-3">
          <p className="mb-2 text-xs font-medium text-muted">
            Ballots (officers only)
          </p>
          <ul className="space-y-2">
            {voters.map((v, i) => {
              const { Icon, color } = CHOICE_ICON[v.choice];
              return (
                <li key={`${v.name}-${i}`} className="flex items-start gap-2 text-sm">
                  <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} aria-hidden />
                  <div className="min-w-0">
                    <p>
                      <span className="font-medium">{v.name}</span>{" "}
                      <span className="text-xs text-muted">
                        · {v.choice === "abstain" ? "abstained" : v.optionLabel ?? v.choice}
                        {" · "}
                        {formatDateTime(v.castAt)}
                      </span>
                    </p>
                    {v.comment && (
                      <p className="mt-0.5 text-xs text-muted">“{v.comment}”</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
