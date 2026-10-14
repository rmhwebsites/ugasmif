// /[fund]/attendance, shown as "Meetings": the class calendar first, then
// your own attendance; officers also see everyone's rate (SPEC 11.2).
//
// The first thing a member wants from this page is when class meets next and
// what is on, so the calendar leads. Upcoming sessions have no attendance to
// show yet, so they are listed apart from the record instead of reading
// "not recorded" down the page.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ManageLink, PageHeader } from "@/components/ui/PageHeader";
import { AttendanceRateTable } from "@/components/tables/AttendanceRateTable";
import { easternDateString, formatDay, formatPercent } from "@/lib/format";
import type {
  Meeting,
  MeetingAttendance,
  Membership,
  Profile,
} from "@/types/domain";

export const metadata: Metadata = { title: "Meetings" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name"> | null;
};

/** Imported titles carry stray double spaces ("Speaker:  David Braun"). */
function tidy(title: string | null): string {
  return title ? title.replace(/\s+/g, " ").trim() : "Fund meeting";
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

  const [meetingsRes, attendanceRes, membersRes] = await Promise.all([
    supabase
      .from("meetings")
      .select("*")
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
  ]);

  const meetings = (meetingsRes.data as Meeting[]) ?? [];
  const meetingIds = new Set(meetings.map((m) => m.id));
  const attendance = ((attendanceRes.data as MeetingAttendance[]) ?? []).filter(
    (a) => meetingIds.has(a.meeting_id)
  );
  const members = (membersRes.data as MemberRow[]) ?? [];

  const today = easternDateString();
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meetings"
        description={
          hasRecord
            ? "The class calendar and your attendance."
            : "The class calendar."
        }
        actions={
          seesEveryone ? (
            <ManageLink href={`/${ctx.fund.slug}/admin/attendance`}>
              Record attendance
            </ManageLink>
          ) : undefined
        }
      />

      {meetings.length === 0 ? (
        <EmptyState
          title="No meetings on the calendar yet"
          hint="Officers add the term's sessions and take attendance from Fund admin."
        />
      ) : (
        <div
          className={`grid gap-6 [&>*]:min-w-0 ${hasRecord ? "lg:grid-cols-2" : ""}`}
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
                        <span className="min-w-0">{tidy(m.title)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <p className="glass-card p-5 text-sm text-muted">
                Nothing else on the calendar this term.
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
                        <span className="min-w-0 truncate">
                          {tidy(meeting.title)}
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
