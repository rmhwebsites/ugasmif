// PATCH /api/[fund]/meetings/[id] — set the attendance grid for a meeting;
// DELETE removes the meeting (officers/advisor/admin).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  attendance: z
    .array(
      z.object({
        user_id: z.uuid(),
        present: z.boolean(),
      })
    )
    .min(1),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "record_attendance")) {
    return NextResponse.json(
      { error: "Officers, the advisor, or an app admin record attendance." },
      { status: 403 }
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!meeting) {
    return NextResponse.json({ error: "Meeting not found." }, { status: 404 });
  }

  const rows = parsed.data.attendance.map((a) => ({
    meeting_id: id,
    user_id: a.user_id,
    present: a.present,
  }));
  const { error } = await supabase
    .from("meeting_attendance")
    .upsert(rows, { onConflict: "meeting_id,user_id" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "attendance.record",
    entity: "meeting_attendance",
    entityId: id,
    after: { rows: rows.length },
  });

  return NextResponse.json({ saved: rows.length });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "record_attendance")) {
    return NextResponse.json({ error: "Officers only." }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("meetings")
    .delete()
    .eq("id", id)
    .eq("fund_id", ctx.fund.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "meeting.delete",
    entity: "meetings",
    entityId: id,
  });

  return NextResponse.json({ ok: true });
}
