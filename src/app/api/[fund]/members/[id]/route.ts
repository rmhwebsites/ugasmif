// PATCH /api/[fund]/members/[id] — edit a membership row inline
// (role, sector, leader flag, status, title). Roster managers only.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  role: z
    .enum([
      "president",
      "vice_president",
      "portfolio_manager",
      "alumni_relations",
      "sector_leader",
      "analyst",
      "viewer",
    ])
    .optional(),
  sector_id: z.uuid().optional().nullable(),
  is_sector_leader: z.boolean().optional(),
  status: z.enum(["active", "alumni", "inactive"]).optional(),
  title_override: z.string().trim().max(80).optional().nullable(),
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
  if (!can(ctx, "manage_roster")) {
    return NextResponse.json(
      { error: "Only roster managers can edit memberships." },
      { status: 403 }
    );
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid membership id." }, { status: 400 });
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
  const { data: before } = await supabase
    .from("memberships")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Membership not found." }, { status: 404 });
  }

  if (parsed.data.sector_id) {
    const { data: sector } = await supabase
      .from("sectors")
      .select("id")
      .eq("id", parsed.data.sector_id)
      .eq("fund_id", ctx.fund.id)
      .maybeSingle();
    if (!sector) {
      return NextResponse.json(
        { error: "That sector is not in this fund." },
        { status: 400 }
      );
    }
  }

  const { data, error } = await supabase
    .from("memberships")
    .update(parsed.data)
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "membership.update",
    entity: "memberships",
    entityId: id,
    before,
    after: data,
  });

  return NextResponse.json({ membership: data });
}
