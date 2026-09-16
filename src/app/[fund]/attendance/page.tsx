// /[fund]/attendance — own record for members; officers see everyone
// (SPEC 11.2).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AttendanceRateTable } from "@/components/tables/AttendanceRateTable";
import { formatDate, formatPercent } from "@/lib/format";
import type {
  Meeting,
  MeetingAttendance,
  Membership,
  Profile,
} from "@/types/domain";

export const metadata: Metadata = { title: "Attendance" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name"> | null;
};

export default async function AttendancePage({
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
      .order("meeting_date", { ascending: false }),
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

  const myRecords = meetings.map((m) => {
    const row = attendance.find(
      (a) => a.meeting_id === m.id && a.user_id === ctx.profile.id
    );
    return { meeting: m, present: row?.present ?? null };
  });
  const attended = myRecords.filter((r) => r.present === true).length;
  const recorded = myRecords.filter((r) => r.present !== null).length;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Attendance</h1>
        {seesEveryone && (
          <Link
            href={`/${ctx.fund.slug}/admin/attendance`}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            Record attendance
          </Link>
        )}
      </div>

      {meetings.length === 0 ? (
        <EmptyState
          title="No meetings recorded yet"
          hint="Officers create meetings and take attendance from the admin page."
        />
      ) : (
        <>
          {/* Own record */}
          <section className="glass-card p-4 sm:p-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold sm:text-lg">
                Your record
              </h2>
              {recorded > 0 && (
                <span className="text-sm text-muted tabular-nums">
                  {attended}/{recorded} ·{" "}
                  {formatPercent((attended / recorded) * 100, 0)}
                </span>
              )}
            </div>
            <ul className="grid gap-1.5">
              {myRecords.map(({ meeting, present }) => (
                <li
                  key={meeting.id}
                  className="flex items-center justify-between rounded-lg bg-highlight px-3 py-2 text-sm"
                >
                  <span>
                    {formatDate(meeting.meeting_date)}
                    {meeting.title && (
                      <span className="text-muted"> · {meeting.title}</span>
                    )}
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
          </section>

          {/* Everyone (officers, advisor) */}
          {seesEveryone && members.length > 0 && (
            <section className="glass-card overflow-hidden">
              <div className="border-b border-card-border px-4 py-3 sm:px-6">
                <h2 className="text-base font-semibold sm:text-lg">
                  All members
                </h2>
              </div>
              <AttendanceRateTable
                rows={members.map((m) => {
                  const theirs = attendance.filter(
                    (a) => a.user_id === m.user_id
                  );
                  return {
                    id: m.id,
                    name: m.profiles?.full_name ?? "—",
                    present: theirs.filter((a) => a.present).length,
                    total: theirs.length,
                    meetingsHeld: meetings.length,
                  };
                })}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
