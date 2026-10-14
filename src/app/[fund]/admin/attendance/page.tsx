// /[fund]/admin/attendance, "Manage meetings": take attendance and add
// meetings (SPEC 11.3). ?meeting=<id> opens the editor on that meeting.

import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, hasFundAdminAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AttendanceEditor,
  type AttendanceMember,
} from "@/components/admin/AttendanceEditor";
import { PageHeader, ViewLink } from "@/components/ui/PageHeader";
import { easternDateString } from "@/lib/format";
import type { Meeting, MeetingAttendance, Membership, Profile } from "@/types/domain";
import { adminTitle } from "../admin-metadata";

export const generateMetadata = adminTitle("attendance", "Manage meetings");

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name"> | null;
};

export default async function AttendanceAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{ meeting?: string }>;
}) {
  const { fund: slug } = await params;
  const { meeting: requestedMeeting } = await searchParams;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!hasFundAdminAccess(ctx)) notFound();

  const header = (
    <PageHeader
      title="Manage meetings"
      description="Add sessions and take attendance"
      actions={
        <ViewLink href={`/${ctx.fund.slug}/attendance`}>View meetings</ViewLink>
      }
    />
  );

  if (!can(ctx, "record_attendance")) {
    return (
      <div className="space-y-4 sm:space-y-6">
        {header}
        <p className="glass-card p-6 text-sm text-muted">
          Officers, the faculty advisor, and app admins record attendance.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const [meetingsRes, membersRes, attendanceRes] = await Promise.all([
    supabase
      .from("meetings")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .order("meeting_date", { ascending: false }),
    supabase
      .from("memberships")
      .select("*, profiles(full_name)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", ctx.currentYear.id)
      .eq("status", "active"),
    supabase.from("meeting_attendance").select("*"),
  ]);

  const meetings = (meetingsRes.data as Meeting[]) ?? [];
  const meetingIds = new Set(meetings.map((m) => m.id));
  const members: AttendanceMember[] = ((membersRes.data as MemberRow[]) ?? [])
    .map((m) => ({
      userId: m.user_id,
      name: m.profiles?.full_name ?? "—",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const attendance = ((attendanceRes.data as MeetingAttendance[]) ?? []).filter(
    (a) => meetingIds.has(a.meeting_id)
  );

  return (
    <div className="space-y-4 sm:space-y-6">
      {header}
      {/* Keyed on the requested meeting so following a link to another
          meeting from this page reopens the editor on it. */}
      <AttendanceEditor
        key={requestedMeeting ?? "default"}
        fund={ctx.fund.slug}
        meetings={meetings}
        members={members}
        attendance={attendance}
        today={easternDateString()}
        initialMeetingId={requestedMeeting ?? null}
      />
    </div>
  );
}
