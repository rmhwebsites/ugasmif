// POST /api/[fund]/pitches/[id]/withdraw — any pre-voting state → withdrawn
// (SPEC Section 12). The author may withdraw their own draft; the sector
// leader or an officer may withdraw through scheduled.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { Pitch } from "@/types/domain";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  const isAuthorDraft = pitch.author_id === user.id && pitch.status === "draft";
  if (!isAuthorDraft && !can(ctx, "withdraw_pitch", { sectorId: pitch.sector_id })) {
    return NextResponse.json(
      {
        error:
          "Only the author (while draft), the sector leader, or an officer can withdraw a pitch",
      },
      { status: 403 }
    );
  }

  if (!["draft", "submitted", "scheduled"].includes(pitch.status)) {
    return NextResponse.json(
      {
        error: `This pitch is ${pitch.status} — only pitches that have not gone to a vote can be withdrawn`,
      },
      { status: 400 }
    );
  }

  const { data: updated, error } = await supabase
    .from("pitches")
    .update({ status: "withdrawn" })
    .eq("id", pitch.id)
    .select("*")
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message ?? "The pitch could not be withdrawn" },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: user.id,
    fundId: ctx.fund.id,
    action: "pitch.withdraw",
    entity: "pitches",
    entityId: pitch.id,
    before: { status: pitch.status },
    after: { status: "withdrawn", title: pitch.title },
  });

  return NextResponse.json({ pitch: updated as Pitch });
}
