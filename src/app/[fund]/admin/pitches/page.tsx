// /[fund]/admin/pitches — the officer's pitch desk (SPEC 11.3): schedule
// submitted pitches to a class date, open/close voting, see the live tally,
// see who has not voted, and send reminders. Officer-gated; the officer's
// votes RLS is what makes the non-voter diff possible server-side.

import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Hourglass, Vote } from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { isOfficer } from "@/lib/permissions";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge, PitchStatusBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScheduleControls } from "@/components/pitch/ScheduleControls";
import { TallyCard, type TallyVoter } from "@/components/pitch/TallyCard";
import { pitchActionLine } from "@/components/pitch/PitchCard";
import {
  easternDateString,
  formatDate,
  formatDateTime,
  formatPercent,
} from "@/lib/format";
import type { Meeting, Pitch, VoteChoice } from "@/types/domain";

interface AdminPitch extends Pitch {
  sector: { name: string } | null;
  author: { full_name: string } | null;
}

interface VoteRow {
  pitch_id: string;
  voter_id: string;
  choice: VoteChoice;
  comment: string | null;
  cast_at: string;
  voter: { full_name: string } | null;
}

interface MemberRow {
  user_id: string;
  profiles: { full_name: string | null } | null;
}

function PitchHeading({
  pitch,
  slug,
}: {
  pitch: AdminPitch;
  slug: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/${slug}/pitches/${pitch.id}`}
          className="font-semibold hover:underline"
        >
          {pitch.title}
        </Link>
        <PitchStatusBadge status={pitch.status} />
      </div>
      <p className="mt-0.5 text-xs text-muted">
        {pitchActionLine(pitch)}
        {pitch.sector?.name ? ` · ${pitch.sector.name}` : ""}
        {pitch.author?.full_name ? ` · ${pitch.author.full_name}` : ""}
        {` · updated ${formatDate(pitch.updated_at)}`}
      </p>
    </div>
  );
}

export default async function AdminPitchesPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!isOfficer(ctx)) notFound();

  const { supabase } = await getAuthState();
  const [pitchesRes, meetingsRes, membersRes] = await Promise.all([
    supabase
      .from("pitches")
      .select("*, sector:sectors(name), author:profiles!author_id(full_name)")
      .eq("fund_id", ctx.fund.id)
      .in("status", ["submitted", "scheduled", "voting", "passed", "failed"])
      .order("created_at", { ascending: false }),
    supabase
      .from("meetings")
      .select("meeting_date")
      .eq("fund_id", ctx.fund.id)
      .gte("meeting_date", easternDateString())
      .order("meeting_date")
      .limit(6),
    supabase
      .from("memberships")
      .select("user_id, profiles(full_name)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", ctx.currentYear.id)
      .eq("status", "active")
      .neq("role", "viewer"),
  ]);

  const pitches = (pitchesRes.data as unknown as AdminPitch[] | null) ?? [];
  const meetingDates = (
    (meetingsRes.data as Pick<Meeting, "meeting_date">[] | null) ?? []
  ).map((m) => m.meeting_date);
  const members = (membersRes.data as unknown as MemberRow[] | null) ?? [];

  const submitted = pitches.filter((p) => p.status === "submitted");
  const scheduled = pitches.filter((p) => p.status === "scheduled");
  const voting = pitches.filter((p) => p.status === "voting");
  const recentlyClosed = pitches
    .filter((p) => p.status === "passed" || p.status === "failed")
    .slice(0, 5);

  // Ballots for the open votes (officer RLS returns every row).
  const votesByPitch = new Map<string, VoteRow[]>();
  if (voting.length > 0) {
    const { data: voteRows } = await supabase
      .from("votes")
      .select("pitch_id, voter_id, choice, comment, cast_at, voter:profiles!voter_id(full_name)")
      .in("pitch_id", voting.map((p) => p.id))
      .order("cast_at");
    for (const v of (voteRows as unknown as VoteRow[] | null) ?? []) {
      const list = votesByPitch.get(v.pitch_id) ?? [];
      list.push(v);
      votesByPitch.set(v.pitch_id, list);
    }
  }

  const windowHours = Number(ctx.fund.vote_default_window_hours);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">Pitch scheduling</h1>
        <p className="text-xs text-muted sm:text-sm">
          Schedule submitted pitches to a class date, open the vote after the
          presentation, and close it (the nightly job closes expired windows on
          its own).
        </p>
      </div>

      {/* ── Awaiting scheduling ────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Hourglass className="h-4 w-4 text-accent" /> Awaiting scheduling
            </span>
          }
        />
        <div className="space-y-3 p-3 sm:p-4">
          {submitted.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted">
              Nothing waiting. Sector leaders submit drafts from the pitch page
              — submitted pitches land here.
            </p>
          ) : (
            submitted.map((p) => (
              <div key={p.id} className="rounded-xl border border-card-border p-3 sm:p-4">
                <PitchHeading pitch={p} slug={slug} />
                <div className="mt-3">
                  <ScheduleControls
                    fund={slug}
                    pitchId={p.id}
                    status={p.status}
                    scheduledFor={p.scheduled_for}
                    voteClosesAt={p.vote_closes_at}
                    defaultWindowHours={windowHours}
                    canSchedule
                    canWithdraw
                    meetingDates={meetingDates}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* ── Scheduled ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-accent" /> Scheduled
            </span>
          }
        />
        <div className="space-y-3 p-3 sm:p-4">
          {scheduled.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted">
              No pitches on the calendar. Schedule a submitted pitch above to a
              class date.
            </p>
          ) : (
            scheduled.map((p) => (
              <div key={p.id} className="rounded-xl border border-card-border p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <PitchHeading pitch={p} slug={slug} />
                  <Badge tone="info">
                    <CalendarClock className="h-3 w-3" />
                    {formatDate(p.scheduled_for)}
                  </Badge>
                </div>
                <div className="mt-3">
                  <ScheduleControls
                    fund={slug}
                    pitchId={p.id}
                    status={p.status}
                    scheduledFor={p.scheduled_for}
                    voteClosesAt={p.vote_closes_at}
                    defaultWindowHours={windowHours}
                    canSchedule
                    canWithdraw
                    meetingDates={meetingDates}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* ── Voting now ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-2">
              <Vote className="h-4 w-4 text-accent" /> Voting now
            </span>
          }
        />
        <div className="space-y-3 p-3 sm:p-4">
          {voting.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted">
              No open votes. Open one on a scheduled pitch after it&apos;s been
              presented in class.
            </p>
          ) : (
            voting.map((p) => {
              const rows = votesByPitch.get(p.id) ?? [];
              const yes = rows.filter((v) => v.choice === "yes").length;
              const no = rows.filter((v) => v.choice === "no").length;
              const votedIds = new Set(rows.map((v) => v.voter_id));
              const nonVoters = members
                .filter((m) => !votedIds.has(m.user_id))
                .map((m) => m.profiles?.full_name ?? "Member");
              const voters: TallyVoter[] = rows.map((v) => ({
                name: v.voter?.full_name ?? "Member",
                choice: v.choice,
                comment: v.comment,
                castAt: v.cast_at,
              }));
              return (
                <div key={p.id} className="rounded-xl border border-card-border p-3 sm:p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <PitchHeading pitch={p} slug={slug} />
                    <span className="text-xs text-muted">
                      Closes {formatDateTime(p.vote_closes_at)} ET
                    </span>
                  </div>
                  <div className="mt-4 grid gap-4 lg:grid-cols-2">
                    <TallyCard
                      yes={yes}
                      no={no}
                      eligible={p.eligible_voters}
                      thresholdPct={Number(ctx.fund.vote_pass_threshold_pct)}
                      quorumPct={
                        ctx.fund.vote_quorum_pct === null
                          ? null
                          : Number(ctx.fund.vote_quorum_pct)
                      }
                      live
                      voters={voters}
                    />
                    <div>
                      <p className="mb-2 text-[11px] uppercase tracking-wider text-muted">
                        Has not voted ({nonVoters.length})
                      </p>
                      {nonVoters.length === 0 ? (
                        <p className="text-sm text-gain">
                          Everyone eligible has voted — close it whenever
                          you&apos;re ready.
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {nonVoters.map((name, i) => (
                            <span
                              key={`${name}-${i}`}
                              className="rounded-full bg-highlight px-2.5 py-1 text-xs"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-4">
                        <ScheduleControls
                          fund={slug}
                          pitchId={p.id}
                          status={p.status}
                          scheduledFor={p.scheduled_for}
                          voteClosesAt={p.vote_closes_at}
                          defaultWindowHours={windowHours}
                          canSchedule
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      {/* ── Recently closed ────────────────────────────────────────────── */}
      {recentlyClosed.length > 0 ? (
        <Card>
          <CardHeader title="Recently closed" />
          <ul className="divide-y divide-card-border/60 p-3 sm:p-4">
            {recentlyClosed.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-2 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/${slug}/pitches/${p.id}`}
                      className="text-sm font-medium hover:underline"
                    >
                      {p.title}
                    </Link>
                    <PitchStatusBadge status={p.status} />
                  </div>
                </div>
                <span
                  className={`text-sm font-semibold tabular-nums ${
                    p.status === "failed" ? "text-loss" : "text-gain"
                  }`}
                >
                  {formatPercent(p.result_pct === null ? null : Number(p.result_pct))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        pitches.length === 0 && (
          <EmptyState
            title="The pitch pipeline is empty"
            hint="Sector teams draft pitches under Pitches → New pitch. Once a leader submits one, it shows up here for scheduling."
          />
        )
      )}
    </div>
  );
}
