// /[fund]/admin/attendance — create meetings and take attendance
// (SPEC 11.3).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, hasFundAdminAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  AttendanceEditor,
  type AttendanceMember,
} from "@/components/admin/AttendanceEditor";
import { Card, CardHeader } from "@/components/ui/Card";
import type { Meeting, MeetingAttendance, Membership, Profile } from "@/types/domain";

export const metadata: Metadata = { title: "Attendance Admin" };

type MemberRow = Membership & {
  profiles: Pick<Profile, "full_name"> | null;
};

export default async function AttendanceAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!hasFundAdminAccess(ctx)) notFound();

  if (!can(ctx, "record_attendance")) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="font-medium">Attendance</p>
        <p className="mt-1 text-sm text-muted">
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
      <h1 className="text-2xl font-bold sm:text-3xl">Attendance</h1>
      <Card>
        <CardHeader title="Meetings and attendance" />
        <div className="p-4 sm:p-6">
          <AttendanceEditor
            fund={ctx.fund.slug}
            meetings={meetings}
            members={members}
            attendance={attendance}
          />
        </div>
      </Card>
    </div>
  );
}
