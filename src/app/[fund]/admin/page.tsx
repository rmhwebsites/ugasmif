// /[fund]/admin — the officer checklist (SPEC 11.3): pending tickets, stale
// marks, pitches awaiting scheduling, votes closing today, meetings and
// attendance, last backup, recent invites. Each card shows only to people
// who can act on it and opens the page where that work is done.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import {
  can,
  canExecute,
  canOpenAdminSection,
  hasFundAdminAccess,
} from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/Badge";
import { PageHeader, ViewLink } from "@/components/ui/PageHeader";
import { RunBackupButton } from "@/components/admin/RunBackupButton";
import {
  easternDateString,
  formatDate,
  formatDateTime,
} from "@/lib/format";
import type {
  BackupRun,
  BondMark,
  Holding,
  Meeting,
  Membership,
  Pitch,
  Profile,
  TradeTicket,
} from "@/types/domain";
import { adminTitle } from "./admin-metadata";

export const generateMetadata = adminTitle("", "Checklist");

type MemberRow = Membership & { profiles: Pick<Profile, "full_name" | "created_at"> | null };
type MeetingRow = Pick<Meeting, "id" | "meeting_date" | "title">;

interface ChecklistItem {
  title: string;
  count: number;
  href: string;
  detail: string;
  /** What you do once you get there, e.g. "Record execution". */
  cta: string;
  urgent: boolean;
  show: boolean;
}

function meetingName(m: MeetingRow): string {
  return `${formatDate(m.meeting_date)}${m.title ? ` · ${m.title}` : ""}`;
}

export default async function AdminChecklistPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!hasFundAdminAccess(ctx)) notFound();

  const fund = ctx.fund.slug;
  const admin = `/${fund}/admin`;
  const executes = canExecute(ctx);
  const schedules = can(ctx, "schedule_pitch");
  const seesPitchDesk = canOpenAdminSection(ctx, "pitches");
  const takesAttendance = canOpenAdminSection(ctx, "attendance");
  const managesRoster = can(ctx, "manage_roster");
  const watchesMarks = executes && ctx.fund.asset_class === "fixed_income";

  const supabase = await createSupabaseServerClient();
  const staleDays = Number(ctx.fund.settings.stale_mark_days ?? 7);
  const now = new Date();
  const today = easternDateString();
  const endOfToday = new Date(now);
  endOfToday.setUTCHours(23, 59, 59, 999);

  const [
    ticketsRes,
    pitchesRes,
    votingRes,
    holdingsRes,
    marksRes,
    backupRes,
    recentMembersRes,
    lastMeetingRes,
    nextMeetingRes,
  ] = await Promise.all([
    supabase
      .from("trade_tickets")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .eq("status", "pending")
      .order("created_at"),
    supabase
      .from("pitches")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .eq("status", "submitted")
      .order("created_at"),
    supabase
      .from("pitches")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .eq("status", "voting")
      .order("vote_closes_at"),
    watchesMarks
      ? supabase
          .from("holdings")
          .select("*")
          .eq("fund_id", ctx.fund.id)
          .eq("is_active", true)
          .eq("pricing_method", "manual")
      : Promise.resolve({ data: [] as Holding[] }),
    watchesMarks
      ? supabase
          .from("bond_marks")
          .select("*")
          .order("marked_at", { ascending: false })
      : Promise.resolve({ data: [] as BondMark[] }),
    supabase
      .from("backup_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(1),
    managesRoster
      ? supabase
          .from("memberships")
          .select("*, profiles(full_name, created_at)")
          .eq("fund_id", ctx.fund.id)
          .eq("academic_year_id", ctx.currentYear.id)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as MemberRow[] }),
    // The latest meeting this year on or before today: the one whose
    // attendance should be in by now.
    supabase
      .from("meetings")
      .select("id, meeting_date, title")
      .eq("fund_id", ctx.fund.id)
      .gte("meeting_date", ctx.currentYear.starts_on)
      .lte("meeting_date", today)
      .order("meeting_date", { ascending: false })
      .limit(1),
    supabase
      .from("meetings")
      .select("id, meeting_date, title")
      .eq("fund_id", ctx.fund.id)
      .gt("meeting_date", today)
      .order("meeting_date")
      .limit(1),
  ]);

  const tickets = (ticketsRes.data as TradeTicket[]) ?? [];
  const submitted = (pitchesRes.data as Pitch[]) ?? [];
  const voting = (votingRes.data as Pitch[]) ?? [];
  const manualHoldings = (holdingsRes.data as Holding[]) ?? [];
  const marks = (marksRes.data as BondMark[]) ?? [];
  const lastBackup = ((backupRes.data as BackupRun[]) ?? [])[0] ?? null;
  const recentMembers = (recentMembersRes.data as MemberRow[]) ?? [];
  const lastMeeting = ((lastMeetingRes.data as MeetingRow[]) ?? [])[0] ?? null;
  const nextMeeting = ((nextMeetingRes.data as MeetingRow[]) ?? [])[0] ?? null;

  let attendanceTaken = true;
  if (takesAttendance && lastMeeting) {
    const { count } = await supabase
      .from("meeting_attendance")
      .select("id", { count: "exact", head: true })
      .eq("meeting_id", lastMeeting.id);
    attendanceTaken = (count ?? 0) > 0;
  }

  const latestMarkByHolding = new Map<string, BondMark>();
  for (const m of marks) {
    if (!latestMarkByHolding.has(m.holding_id)) {
      latestMarkByHolding.set(m.holding_id, m);
    }
  }
  const staleCutoff = now.getTime() - staleDays * 24 * 60 * 60 * 1000;
  const staleMarks = manualHoldings
    .map((h) => ({ holding: h, mark: latestMarkByHolding.get(h.id) ?? null }))
    .filter(
      ({ mark }) => !mark || new Date(mark.marked_at).getTime() < staleCutoff
    );

  const closingToday = voting.filter(
    (p) => p.vote_closes_at && new Date(p.vote_closes_at) <= endOfToday
  );
  const invitedRecently = recentMembers.filter((m) => {
    const created = m.profiles?.created_at;
    return created
      ? now.getTime() - new Date(created).getTime() < 30 * 24 * 60 * 60 * 1000
      : false;
  });

  const ticketList = tickets
    .map(
      (t) =>
        `${t.action === "buy" ? "Buy" : "Sell"} ${t.symbol ?? t.name}`
    )
    .join(", ");

  // Meetings: attendance for the latest meeting, and something on the
  // calendar after today.
  const missingAttendance = lastMeeting !== null && !attendanceTaken;
  const meetingTodos = (missingAttendance ? 1 : 0) + (nextMeeting ? 0 : 1);
  const meetingDetail = [
    lastMeeting
      ? missingAttendance
        ? `Attendance not taken for ${meetingName(lastMeeting)}.`
        : `Attendance taken for ${meetingName(lastMeeting)}.`
      : null,
    nextMeeting
      ? `Next meeting ${meetingName(nextMeeting)}.`
      : "No meetings on the calendar after today.",
  ]
    .filter(Boolean)
    .join(" ");

  const items: ChecklistItem[] = [
    executes
      ? {
          title: "Pending tickets",
          count: tickets.length,
          // One ticket: straight to its form. Several: the list.
          href:
            tickets.length === 1
              ? `${admin}/tickets#ticket-${tickets[0].id}`
              : `${admin}/tickets`,
          detail:
            tickets.length > 0 ? ticketList : "Nothing waiting to be executed.",
          cta: tickets.length > 0 ? "Record execution" : "Manage tickets",
          urgent: tickets.length > 0,
          show: true,
        }
      : {
          // Officers who don't trade still see what the PM has to do.
          title: "Pending tickets",
          count: tickets.length,
          href: `/${fund}/trades`,
          detail:
            tickets.length > 0
              ? `Waiting on the PM: ${ticketList}`
              : "Nothing waiting to be executed.",
          cta: "View trades",
          urgent: false,
          show: true,
        },
    {
      title: "Stale bond marks",
      count: staleMarks.length,
      href: `${admin}/holdings?stale=1#marks`,
      detail:
        staleMarks.length > 0
          ? `Older than ${staleDays} days: ${staleMarks
              .slice(0, 4)
              .map(({ holding }) => holding.name)
              .join(", ")}${staleMarks.length > 4 ? "…" : ""}`
          : "All manual marks are fresh.",
      cta: staleMarks.length > 0 ? "Enter marks" : "Manage holdings",
      urgent: staleMarks.length > 0,
      show: watchesMarks,
    },
    {
      title: "Pitches awaiting scheduling",
      count: submitted.length,
      href: `${admin}/pitches#awaiting`,
      detail:
        submitted.length > 0
          ? submitted.map((p) => p.title).join(", ")
          : "No submitted pitches in the queue.",
      cta: submitted.length > 0 ? "Schedule" : "Manage pitches",
      urgent: submitted.length > 0,
      show: schedules,
    },
    {
      title: "Votes closing today",
      count: closingToday.length,
      href: `${admin}/pitches#voting`,
      detail:
        closingToday.length > 0
          ? closingToday
              .map(
                (p) => `${p.title} at ${formatDateTime(p.vote_closes_at)}`
              )
              .join(", ")
          : voting.length > 0
          ? `${voting.length} open ${voting.length === 1 ? "vote" : "votes"}, none closing today.`
          : "No open votes.",
      cta: voting.length > 0 ? "See who hasn't voted" : "Manage pitches",
      urgent: closingToday.length > 0,
      show: seesPitchDesk,
    },
    {
      title: "Meetings",
      count: meetingTodos,
      href:
        missingAttendance && lastMeeting
          ? `${admin}/attendance?meeting=${lastMeeting.id}`
          : !nextMeeting
          ? `${admin}/attendance#add-meeting`
          : `${admin}/attendance`,
      detail: meetingDetail,
      cta: missingAttendance
        ? "Take attendance"
        : !nextMeeting
        ? "Add meetings"
        : "Manage meetings",
      urgent: meetingTodos > 0,
      show: takesAttendance,
    },
  ].filter((i) => i.show);

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Checklist"
        description={`What is waiting in ${ctx.fund.name}. Each card opens the page where you do it.`}
        actions={<ViewLink href={`/${fund}`}>View dashboard</ViewLink>}
      />

      <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        {items.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="glass-card group flex flex-col p-4 transition-colors hover:bg-highlight sm:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{item.title}</h2>
              <Badge tone={item.urgent ? "accent" : "neutral"}>
                {item.count}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-2 text-sm text-muted">
              {item.detail}
            </p>
            <p className="mt-auto pt-2 text-sm font-medium text-accent-text group-hover:underline">
              {item.cta} <span aria-hidden="true">→</span>
            </p>
          </Link>
        ))}
      </div>

      {/* Backup status */}
      <section className="glass-card flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div>
          <h2 className="font-semibold">Nightly backup</h2>
          <p className="mt-0.5 text-sm text-muted">
            {lastBackup ? (
              <>
                Last run {formatDateTime(lastBackup.started_at)} ·{" "}
                <span
                  className={
                    lastBackup.status === "ok"
                      ? "text-gain"
                      : lastBackup.status === "failed"
                      ? "text-loss"
                      : ""
                  }
                >
                  {lastBackup.status}
                </span>
                {lastBackup.rows_written !== null && (
                  <> · {lastBackup.rows_written} rows</>
                )}
              </>
            ) : (
              "No backup has run yet."
            )}
          </p>
        </div>
        {can(ctx, "trigger_backup") && <RunBackupButton />}
      </section>

      {/* Recently invited: only for the people who can fix a stuck invite. */}
      {managesRoster && (
        <section className="glass-card p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">Recently invited members</h2>
            <Link
              href={`${admin}/members`}
              className="text-sm font-medium text-accent-text hover:underline"
            >
              Manage members
            </Link>
          </div>
          <p className="mt-0.5 text-sm text-muted">
            Accounts created in the last 30 days. If someone can&apos;t sign
            in, open their name to resend the invite or set a temporary
            password. Anyone who has already signed up gets a reset link
            instead of an invite.
          </p>
          {invitedRecently.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2 text-sm">
              {invitedRecently.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`${admin}/members/${m.id}`}
                    className="inline-block rounded-lg bg-highlight px-3 py-1 transition-colors hover:bg-card-border"
                  >
                    {m.profiles?.full_name ?? "—"}
                    <span className="text-muted">
                      {" "}
                      · {formatDate(m.profiles?.created_at ?? null)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">None.</p>
          )}
        </section>
      )}
    </div>
  );
}
