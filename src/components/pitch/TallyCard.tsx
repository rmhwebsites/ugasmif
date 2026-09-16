// Yes/No tally for a pitch vote (SPEC Section 12). Presentational only, so
// both server pages (admin live tallies) and the client VotePanel can render
// it. Voter names + comments are passed only for callers that already hold
// can(ctx, "view_individual_votes") — this component never fetches.

import { CheckCircle2, Users, XCircle } from "lucide-react";
import { formatDateTime, formatPercent } from "@/lib/format";
import type { VoteChoice } from "@/types/domain";

export interface TallyVoter {
  name: string;
  choice: VoteChoice;
  comment: string | null;
  castAt: string;
}

export function TallyCard({
  yes,
  no,
  eligible,
  thresholdPct,
  quorumPct = null,
  resultPct = null,
  outcome = null,
  live = false,
  myChoice = null,
  voters = null,
  className = "",
}: {
  yes: number;
  no: number;
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
  /** Officer/advisor-only voter roll; omit for members. */
  voters?: TallyVoter[] | null;
  className?: string;
}) {
  const cast = yes + no;
  const pctYes = resultPct !== null ? Number(resultPct) : cast > 0 ? (yes / cast) * 100 : 0;
  const pctNo = cast > 0 ? 100 - (cast > 0 ? (yes / cast) * 100 : 0) : 0;

  const rows = [
    {
      choice: "yes" as const,
      label: "Yes",
      count: yes,
      pct: cast > 0 ? (yes / cast) * 100 : 0,
      icon: CheckCircle2,
      textColor: "text-gain",
      barColor: "bg-gain",
    },
    {
      choice: "no" as const,
      label: "No",
      count: no,
      pct: pctNo,
      icon: XCircle,
      textColor: "text-loss",
      barColor: "bg-loss",
    },
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
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <div key={row.choice}>
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Icon className={`h-4 w-4 ${row.textColor}`} />
                  <span className="text-sm font-medium">{row.label}</span>
                  {myChoice === row.choice && (
                    <span className="text-[10px] text-accent">(your vote)</span>
                  )}
                </div>
                <span className={`text-sm font-semibold tabular-nums ${row.textColor}`}>
                  {row.count}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-highlight">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${row.barColor}`}
                  style={{ width: `${row.pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {cast} of {eligible ?? "?"} eligible voted
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
          <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">
            Ballots (officers only)
          </p>
          <ul className="space-y-2">
            {voters.map((v, i) => (
              <li key={`${v.name}-${i}`} className="flex items-start gap-2 text-sm">
                {v.choice === "yes" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gain" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-loss" />
                )}
                <div className="min-w-0">
                  <p>
                    <span className="font-medium">{v.name}</span>{" "}
                    <span className="text-xs text-muted">
                      · {formatDateTime(v.castAt)}
                    </span>
                  </p>
                  {v.comment && (
                    <p className="mt-0.5 text-xs text-muted">“{v.comment}”</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
