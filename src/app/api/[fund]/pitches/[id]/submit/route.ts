// POST /api/[fund]/pitches/[id]/submit — draft → submitted (SPEC Section 12).
// Sector leader of the pitch's sector, or an officer. Emails the fund's
// officers "Pitch submitted".

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can, OFFICER_ROLES } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { sendToFund } from "@/lib/emails/send";
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
    .select("*, sector:sectors(name)")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!pitchRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const pitch = pitchRow as Pitch & { sector: { name: string } | null };

  if (!can(ctx, "submit_pitch", { sectorId: pitch.sector_id })) {
    return NextResponse.json(
      { error: "Only the sector's leader or a fund officer can submit a pitch" },
      { status: 403 }
    );
  }
  if (pitch.status !== "draft") {
    return NextResponse.json(
      { error: `This pitch is ${pitch.status} — only drafts can be submitted` },
      { status: 400 }
    );
  }

  const { data: updated, error } = await supabase
    .from("pitches")
    .update({ status: "submitted" })
    .eq("id", pitch.id)
    .select("*")
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message ?? "The pitch could not be submitted" },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: user.id,
    fundId: ctx.fund.id,
    action: "pitch.submit",
    entity: "pitches",
    entityId: pitch.id,
    before: { status: "draft" },
    after: { status: "submitted", title: pitch.title },
  });

  // Officers get "Pitch submitted" (SPEC Section 16). Not in the two mutable
  // categories, so it always sends.
  await sendToFund(supabase, ctx.fund.id, {
    subject: `Pitch submitted: ${pitch.title}`,
    heading: "A pitch is ready to schedule",
    bodyLines: [
      `"${pitch.title}" (${pitch.sector?.name ?? "no sector"}) was submitted by ${ctx.profile.full_name}.`,
      "Review it, then schedule it for a class date and open the vote after it is presented.",
    ],
    ctaLabel: "Review and schedule",
    ctaPath: `/${ctx.fund.slug}/admin/pitches`,
    roles: OFFICER_ROLES,
    essential: true,
  });

  return NextResponse.json({ pitch: updated as Pitch });
}
