// One pitch in a list (pitches index, sector page). Server-safe
// presentational component — actions are plain links; state-changing buttons
// live in ScheduleControls / VotePanel. The title link stretches over the
// whole card, so anywhere on it opens the pitch; the sector link and the
// Vote, Submit and Schedule shortcuts sit above that layer. Vote and Submit
// land on the pitch page's #vote and #actions cards.

import Link from "next/link";
import {
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Send,
  Vote,
  XCircle,
} from "lucide-react";
import { Badge, PitchStatusBadge } from "@/components/ui/Badge";
import { SectorLink } from "@/components/ui/SectorLink";
import { formatDate, formatDateTime, formatPercent } from "@/lib/format";
import type { Pitch, PitchAction, VoteChoice } from "@/types/domain";

/**
 * Pitch row with the joins the list pages select. Select the sector as
 * `sector:sectors(name, slug)` so its name links to the sector page.
 */
export interface PitchListItem extends Pitch {
  sector?: { name: string; slug?: string | null } | null;
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
  showSubmit = false,
  myVote,
  canVote = false,
  tradePending = false,
}: {
  pitch: PitchListItem;
  fund: string;
  /** Officers see a Schedule shortcut on submitted pitches (SPEC 11.2). */
  showSchedule?: boolean;
  /**
   * The viewer may submit this pitch (its sector leader, an officer): a
   * draft gets a Submit shortcut to the pitch page's Actions card.
   */
  showSubmit?: boolean;
  /** The viewer's own ballot on this pitch, when they cast one. */
  myVote?: VoteChoice;
  /** Whether the viewer holds a vote at all (active members). */
  canVote?: boolean;
  /** It passed and its trade ticket is still waiting to be executed. */
  tradePending?: boolean;
}) {
  const closed =
    pitch.status === "passed" ||
    pitch.status === "failed" ||
    pitch.status === "executed";
  const pitchHref = `/${fund}/pitches/${pitch.id}`;

  return (
    <div className="glass-card relative p-4 transition-colors hover:bg-highlight sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={pitchHref}
              className="font-semibold after:absolute after:inset-0 after:rounded-[inherit] hover:underline"
            >
              {pitch.title}
            </Link>
            <PitchStatusBadge status={pitch.status} />
            {pitch.pitch_type === "bear" && <Badge tone="loss">bear case</Badge>}
            {tradePending && pitch.status === "passed" && (
              <Badge tone="info">ticket pending</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted sm:text-sm">
            {pitchActionLine(pitch)}
            {pitch.sector?.name && (
              <>
                {" · "}
                <SectorLink
                  fund={fund}
                  slug={pitch.sector.slug}
                  name={pitch.sector.name}
                  className="relative z-10"
                />
              </>
            )}
            {pitch.author?.full_name ? ` · ${pitch.author.full_name}` : ""}
            {closed && pitch.closed_at
              ? ` · closed ${formatDate(pitch.closed_at)}`
              : ` · ${formatDate(pitch.created_at)}`}
            {closed && myVote ? ` · you voted ${myVote}` : ""}
          </p>
        </div>

        <div className="relative z-10 flex shrink-0 items-center gap-3 text-right">
          {pitch.status === "scheduled" && pitch.scheduled_for && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatDate(pitch.scheduled_for)}
            </span>
          )}
          {pitch.status === "voting" && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="text-xs text-muted">
                Closes {formatDateTime(pitch.vote_closes_at)} ET
              </span>
              {myVote === "yes" && (
                <Badge tone="gain">
                  <CheckCircle2 className="h-3 w-3" /> You voted yes
                </Badge>
              )}
              {myVote === "no" && (
                <Badge tone="loss">
                  <XCircle className="h-3 w-3" /> You voted no
                </Badge>
              )}
              {canVote && (
                <Link
                  href={`${pitchHref}#vote`}
                  className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    myVote
                      ? "bg-highlight hover:bg-card-border"
                      : "bg-accent text-on-accent hover:bg-accent-hover"
                  }`}
                >
                  <Vote className="h-3.5 w-3.5" />
                  {myVote ? "Change vote" : "Vote"}
                </Link>
              )}
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
          {showSubmit && pitch.status === "draft" && (
            <Link
              href={`${pitchHref}#actions`}
              className="inline-flex items-center gap-1 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-highlight"
            >
              <Send className="h-3.5 w-3.5" /> Submit
            </Link>
          )}
          {showSchedule && pitch.status === "submitted" && (
            <Link
              href={`${pitchHref}#actions`}
              className="inline-flex items-center gap-1 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-highlight"
            >
              <CalendarClock className="h-3.5 w-3.5" /> Schedule
            </Link>
          )}
          <Link
            href={pitchHref}
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
