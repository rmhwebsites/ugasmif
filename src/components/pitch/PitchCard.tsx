// One pitch in a list (pitches index, votes page, admin queue). Server-safe
// presentational component — actions are plain links; state-changing buttons
// live in ScheduleControls / VotePanel.

import Link from "next/link";
import { CalendarClock, ChevronRight, Vote } from "lucide-react";
import { Badge, PitchStatusBadge } from "@/components/ui/Badge";
import { formatDate, formatDateTime, formatPercent } from "@/lib/format";
import type { Pitch, PitchAction } from "@/types/domain";

/** Pitch row with the joins the list pages select. */
export interface PitchListItem extends Pitch {
  sector?: { name: string } | null;
  author?: { full_name: string } | null;
}

export const PITCH_ACTION_LABELS: Record<PitchAction, string> = {
  buy: "Buy",
  add: "Add",
  trim: "Trim",
  sell: "Sell",
  rebalance: "Rebalance",
};

/** "Buy NVDA" / "Trim GD 4.25% 2042" / "Rebalance" for card meta lines. */
export function pitchActionLine(pitch: Pitch): string {
  const security = pitch.symbol ?? pitch.instrument_name;
  const verb = PITCH_ACTION_LABELS[pitch.action] ?? pitch.action;
  return security ? `${verb} ${security}` : verb;
}

export function PitchCard({
  pitch,
  fund,
  showSchedule = false,
}: {
  pitch: PitchListItem;
  fund: string;
  /** Officers see a Schedule shortcut on submitted pitches (SPEC 11.2). */
  showSchedule?: boolean;
}) {
  const closed =
    pitch.status === "passed" ||
    pitch.status === "failed" ||
    pitch.status === "executed";

  return (
    <div className="glass-card p-4 transition-colors hover:bg-highlight/50 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/${fund}/pitches/${pitch.id}`}
              className="font-semibold hover:underline"
            >
              {pitch.title}
            </Link>
            <PitchStatusBadge status={pitch.status} />
            {pitch.pitch_type === "bear" && <Badge tone="loss">bear case</Badge>}
          </div>
          <p className="mt-1 text-xs text-muted sm:text-sm">
            {pitchActionLine(pitch)}
            {pitch.sector?.name ? ` · ${pitch.sector.name}` : ""}
            {pitch.author?.full_name ? ` · ${pitch.author.full_name}` : ""}
            {` · ${formatDate(pitch.created_at)}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-right">
          {pitch.status === "scheduled" && pitch.scheduled_for && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDate(pitch.scheduled_for)}
            </span>
          )}
          {pitch.status === "voting" && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">
                Closes {formatDateTime(pitch.vote_closes_at)}
              </span>
              <Link
                href={`/${fund}/pitches/${pitch.id}`}
                className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
              >
                <Vote className="h-3.5 w-3.5" /> Vote
              </Link>
            </div>
          )}
          {closed && pitch.result_pct !== null && (
            <div>
              <p
                className={`text-sm font-semibold tabular-nums ${
                  pitch.status === "failed" ? "text-loss" : "text-gain"
                }`}
              >
                {formatPercent(Number(pitch.result_pct))} yes
              </p>
              <p className="text-xs tabular-nums text-muted">
                {pitch.votes_yes}–{pitch.votes_no}
              </p>
            </div>
          )}
          {showSchedule && pitch.status === "submitted" && (
            <Link
              href={`/${fund}/admin/pitches`}
              className="inline-flex items-center gap-1 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-highlight"
            >
              <CalendarClock className="h-3.5 w-3.5" /> Schedule
            </Link>
          )}
          <Link
            href={`/${fund}/pitches/${pitch.id}`}
            aria-label={`Open ${pitch.title}`}
            className="text-muted transition-colors hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
