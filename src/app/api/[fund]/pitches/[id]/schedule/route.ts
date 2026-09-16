// POST /api/[fund]/pitches/[id]/schedule — submitted/scheduled → scheduled
// with a class date (SPEC Section 12). Officers (and app admins) only; shows
// on the dashboard as "Upcoming pitches".

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { Pitch } from "@/types/domain";

const bodySchema = z.object({
  scheduled_for: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "scheduled_for must be YYYY-MM-DD"),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "schedule_pitch")) {
    return NextResponse.json(
      { error: "Only fund officers can schedule pitches" },
      { status: 403 }
    );
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid date" },
      { status: 400 }
    );
  }

  const { supabase, user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: pitchRow } = await supabase
    .from("pitches")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!pitchRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const pitch = pitchRow as Pitch;

  if (pitch.status !== "submitted" && pitch.status !== "scheduled") {
    return NextResponse.json(
      {
        error: `This pitch is ${pitch.status} — only submitted (or already scheduled) pitches can be scheduled`,
      },
      { status: 400 }
    );
  }

  const { data: updated, error } = await supabase
    .from("pitches")
    .update({ status: "scheduled", scheduled_for: parsed.data.scheduled_for })
    .eq("id", pitch.id)
    .select("*")
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message ?? "The pitch could not be scheduled" },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: user.id,
    fundId: ctx.fund.id,
    action: "pitch.schedule",
    entity: "pitches",
    entityId: pitch.id,
    before: { status: pitch.status, scheduled_for: pitch.scheduled_for },
    after: { status: "scheduled", scheduled_for: parsed.data.scheduled_for },
  });

  return NextResponse.json({ pitch: updated as Pitch });
}
