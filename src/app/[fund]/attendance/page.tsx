// /[fund]/attendance, shown as "Meetings": upcoming meetings first, then
// your own attendance; officers also see everyone's rate (SPEC 11.2).
//
// The first thing a member wants from this page is when class meets next and
// what is on, so upcoming meetings lead, and each one lists the
// pitches given its date. Upcoming sessions have no attendance to show yet,
// so they are listed apart from the record instead of reading "not
// recorded" down the page. Meeting notes are never shown here: officers keep
// internal notes in them.
//
// Whoever takes attendance (officers, the advisor, app admins) gets a link
// on each meeting from today back that opens the editor on it
// (/admin/attendance?meeting=<id>). Future sessions get none: attendance is
// taken on the day or after. The advisor and app admins have no record of
// their own, so they get a "Past meetings" list in its place.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Presentation } from "lucide-react";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, canOpenAdminSection } from "@/lib/permissions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  LinkButton,
  ManageLink,
  PageHeader,
} from "@/components/ui/PageHeader";
import { AttendanceRateTable } from "@/components/tables/AttendanceRateTable";
import { easternDateString, formatDay, formatPercent } from "@/lib/format";
import type {
  Meeting,
  MeetingAttendance,
  Membership,
  Pitch,
  Profile,
} from "@/types/domain";

export const metadata: Metadata = { title: "Meetings" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name"> | null;
};

// Never the notes column: officers keep internal notes there.
type MeetingRow = Pick<Meeting, "id" | "meeting_date" | "title">;
type AgendaPitch = Pick<Pitch, "id" | "title" | "status" | "scheduled_for">;

/** Imported titles carry stray double spaces ("Speaker:  David Braun"). */
function tidy(title: string | null): string {
  return title ? title.replace(/\s+/g, " ").trim() : "Fund meeting";
}

/** The pitches given a meeting's date, each a link to the pitch. */
function Agenda({ fund, pitches }: { fund: string; pitches: AgendaPitch[] }) {
  if (pitches.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {pitches.map((p) => (
        <li key={p.id} className="flex min-w-0 items-center gap-1.5 text-sm">
          <Presentation
            className="h-3.5 w-3.5 shrink-0 text-muted"
            aria-hidden="true"
          />
          <Link
            href={`/${fund}/pitches/${p.id}`}
            className="min-w-0 truncate font-medium text-accent-text hover:underline"
          >
            {p.title}
          </Link>
          {p.status === "voting" && <Badge tone="accent">voting open</Badge>}
        </li>
      ))}
    </ul>
  );
}

/** Opens the attendance editor on one meeting. */
function AttendanceLink({
  fund,
  meetingId,
  taken,
  className = "text-xs",
}: {
  fund: string;
  meetingId: string;
  taken: boolean;
  className?: string;
}) {
  return (
    <Link
      href={`/${fund}/admin/attendance?meeting=${meetingId}`}
      className={`-my-1 inline-block py-1 font-medium text-accent-text hover:underline ${className}`}
    >
      {taken ? "Edit attendance" : "Take attendance"}
    </Link>
  );
}

export default async function MeetingsPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const supabase = await createSupabaseServerClient();
  const seesEveryone = can(ctx, "record_attendance");
  const managesMeetings = canOpenAdminSection(ctx, "attendance");
  const today = easternDateString();

  const [meetingsRes, attendanceRes, membersRes, agendaRes] = await Promise.all([
    supabase
      .from("meetings")
      .select("id, meeting_date, title")
      .eq("fund_id", ctx.fund.id)
      .order("meeting_date", { ascending: true }),
    supabase.from("meeting_attendance").select("*"),
    seesEveryone
      ? supabase
          .from("memberships")
          .select("*, profiles(full_name)")
          .eq("fund_id", ctx.fund.id)
          .eq("academic_year_id", ctx.currentYear.id)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    // What is on each upcoming meeting: pitches given that class date.
    supabase
      .from("pitches")
      .select("id, title, status, scheduled_for")
      .eq("fund_id", ctx.fund.id)
      .gte("scheduled_for", today)
      .in("status", ["scheduled", "voting", "passed", "failed", "executed"])
      .order("created_at", { ascending: true }),
  ]);

  const meetings = (meetingsRes.data as MeetingRow[]) ?? [];
  const meetingIds = new Set(meetings.map((m) => m.id));
  const attendance = ((attendanceRes.data as MeetingAttendance[]) ?? []).filter(
    (a) => meetingIds.has(a.meeting_id)
  );
  const members = (membersRes.data as MemberRow[]) ?? [];
  const agendaByDate = new Map<string, AgendaPitch[]>();
  for (const p of (agendaRes.data as AgendaPitch[]) ?? []) {
    if (!p.scheduled_for) continue;
    const list = agendaByDate.get(p.scheduled_for) ?? [];
    list.push(p);
    agendaByDate.set(p.scheduled_for, list);
  }
  const agendaFor = (date: string) => agendaByDate.get(date) ?? [];

  const upcoming = meetings.filter((m) => m.meeting_date >= today);
  const past = meetings.filter((m) => m.meeting_date < today).reverse();

  const myRecords = past.map((m) => {
    const row = attendance.find(
      (a) => a.meeting_id === m.id && a.user_id === ctx.profile.id
    );
    return { meeting: m, present: row?.present ?? null };
  });
  const attended = myRecords.filter((r) => r.present === true).length;
  const recorded = myRecords.filter((r) => r.present !== null).length;

  const [next, ...later] = upcoming;
  // App admins and the advisor can open any fund without being on its
  // roster; they have no record of their own to show.
  const hasRecord = ctx.membership !== null;

  // For whoever takes attendance: which meetings have any taken, and how
  // many were present (they can read every row; members only their own).
  const takenFor = new Map<string, { present: number; total: number }>();
  if (managesMeetings) {
    for (const a of attendance) {
      const t = takenFor.get(a.meeting_id) ?? { present: 0, total: 0 };
      t.total += 1;
      if (a.present) t.present += 1;
      takenFor.set(a.meeting_id, t);
    }
  }
  const attendanceLinkFor = (m: MeetingRow, className?: string) =>
    managesMeetings && m.meeting_date <= today ? (
      <AttendanceLink
        fund={ctx.fund.slug}
        meetingId={m.id}
        taken={takenFor.has(m.id)}
        className={className}
      />
    ) : null;
  const showsPastList = !hasRecord && managesMeetings && past.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description={
          hasRecord
            ? "Class meetings, the pitches on each, and your attendance."
            : "Class meetings and the pitches on each."
        }
        actions={
          managesMeetings ? (
            <ManageLink href={`/${ctx.fund.slug}/admin/attendance`}>
              Manage meetings
            </ManageLink>
          ) : undefined
        }
      />

      {meetings.length === 0 ? (
        <EmptyState
          title="No meetings scheduled yet"
          hint={
            managesMeetings
              ? "Add the term's sessions, then take attendance after each one."
              : "Officers add the term's sessions here."
          }
          action={
            managesMeetings ? (
              <LinkButton
                href={`/${ctx.fund.slug}/admin/attendance#add-meeting`}
              >
                Add meetings
              </LinkButton>
            ) : undefined
          }
        />
      ) : (
        <div
          className={`grid gap-6 [&>*]:min-w-0 ${
            hasRecord || showsPastList ? "lg:grid-cols-2" : ""
          }`}
        >
          <section className="space-y-3">
            <h2 className="text-lg font-semibold">Coming up</h2>
            {next ? (
              <>
                <div className="glass-card p-5 sm:p-6">
                  <p className="text-sm text-muted">Next meeting</p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">
                    {formatDay(next.meeting_date)}
                  </p>
                  <p className="mt-1 text-base">{tidy(next.title)}</p>
                  {agendaFor(next.meeting_date).length > 0 && (
                    <div className="mt-3">
                      <p className="text-sm text-muted">Pitches</p>
                      <Agenda
                        fund={ctx.fund.slug}
                        pitches={agendaFor(next.meeting_date)}
                      />
                    </div>
                  )}
                  {next.meeting_date === today && managesMeetings && (
                    <div className="mt-3">
                      {attendanceLinkFor(next, "text-sm")}
                    </div>
                  )}
                </div>
                {later.length > 0 && (
                  <ul className="glass-card divide-y divide-card-border overflow-hidden">
                    {later.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-baseline gap-4 px-5 py-3 text-sm"
                      >
                        <span className="w-24 shrink-0 tabular-nums text-muted">
                          {formatDay(m.meeting_date)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p>{tidy(m.title)}</p>
                          <Agenda
                            fund={ctx.fund.slug}
                            pitches={agendaFor(m.meeting_date)}
                          />
                          {attendanceLinkFor(m)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="glass-card p-5 text-sm text-muted">
                No more meetings scheduled this term.
              </p>
            )}
          </section>

          {hasRecord && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-lg font-semibold">Your attendance</h2>
                {recorded > 0 && (
                  <span className="text-sm tabular-nums text-muted">
                    {attended} of {recorded} ·{" "}
                    {formatPercent((attended / recorded) * 100, 0)}
                  </span>
                )}
              </div>
              {myRecords.length === 0 ? (
                <p className="glass-card p-5 text-sm text-muted">
                  Your record starts after the first meeting.
                </p>
              ) : (
                <ul className="glass-card divide-y divide-card-border overflow-hidden">
                  {myRecords.map(({ meeting, present }) => (
                    <li
                      key={meeting.id}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                    >
                      <span className="flex min-w-0 items-baseline gap-4">
                        <span className="w-24 shrink-0 tabular-nums text-muted">
                          {formatDay(meeting.meeting_date)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">
                            {tidy(meeting.title)}
                          </span>
                          {attendanceLinkFor(meeting)}
                        </span>
                      </span>
                      {present === true ? (
                        <Badge tone="gain">present</Badge>
                      ) : present === false ? (
                        <Badge tone="loss">absent</Badge>
                      ) : (
                        <Badge tone="neutral">not recorded</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {showsPastList && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Past meetings</h2>
              <ul className="glass-card divide-y divide-card-border overflow-hidden">
                {past.map((m) => {
                  const taken = takenFor.get(m.id);
                  return (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
                    >
                      <span className="flex min-w-0 items-baseline gap-4">
                        <span className="w-24 shrink-0 tabular-nums text-muted">
                          {formatDay(m.meeting_date)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{tidy(m.title)}</span>
                          {attendanceLinkFor(m)}
                        </span>
                      </span>
                      {taken ? (
                        <span className="shrink-0 text-xs tabular-nums text-muted">
                          {taken.present} of {taken.total} present
                        </span>
                      ) : (
                        <Badge tone="neutral">not taken</Badge>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}

      {/* Everyone (officers, advisor) */}
      {seesEveryone && members.length > 0 && past.length > 0 && (
        <section className="glass-card overflow-hidden">
          <div className="px-4 pt-4 pb-2 sm:px-6">
            <h2 className="text-lg font-semibold">
              Everyone&apos;s attendance
            </h2>
          </div>
          <AttendanceRateTable
            rows={members.map((m) => {
              const theirs = attendance.filter((a) => a.user_id === m.user_id);
              return {
                id: m.id,
                name: m.profiles?.full_name ?? "—",
                href: canOpenAdminSection(ctx, "members")
                  ? `/${ctx.fund.slug}/admin/members/${m.id}`
                  : undefined,
                present: theirs.filter((a) => a.present).length,
                total: theirs.length,
                meetingsHeld: past.length,
              };
            })}
          />
        </section>
      )}
    </div>
  );
}
