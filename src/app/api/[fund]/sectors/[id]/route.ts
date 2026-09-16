// PATCH/DELETE /api/[fund]/sectors/[id] — rename/reorder/toggle a sector;
// delete only when nothing references it (SPEC Section 9 policy).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { isOfficer } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  is_strategy_team: z.boolean().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(999).optional(),
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
  if (!isOfficer(ctx)) {
    return NextResponse.json({ error: "Officers only." }, { status: 403 });
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid sector id." }, { status: 400 });
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
    .from("sectors")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Sector not found." }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("sectors")
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
    action: "sector.update",
    entity: "sectors",
    entityId: id,
    before,
    after: data,
  });

  return NextResponse.json({ sector: data });
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
  if (!isOfficer(ctx)) {
    return NextResponse.json({ error: "Officers only." }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const [{ count: holdingCount }, { count: pitchCount }] = await Promise.all([
    supabase
      .from("holdings")
      .select("id", { count: "exact", head: true })
      .eq("sector_id", id),
    supabase
      .from("pitches")
      .select("id", { count: "exact", head: true })
      .eq("sector_id", id),
  ]);
  if ((holdingCount ?? 0) > 0 || (pitchCount ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          "This sector still has holdings or pitches. Deactivate it instead.",
      },
      { status: 400 }
    );
  }

  const { data: before } = await supabase
    .from("sectors")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Sector not found." }, { status: 404 });
  }

  const { error } = await supabase
    .from("sectors")
    .delete()
    .eq("id", id)
    .eq("fund_id", ctx.fund.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "sector.delete",
    entity: "sectors",
    entityId: id,
    before,
  });

  return NextResponse.json({ ok: true });
}
