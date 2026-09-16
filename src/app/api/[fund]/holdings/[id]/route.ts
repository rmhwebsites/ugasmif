// PATCH /api/[fund]/holdings/[id] — edit or deactivate a holding
// (SPEC 11.3). Holdings are never deleted; deactivation sets closed_on.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import { easternDateString } from "@/lib/format";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  symbol: z.string().trim().max(12).optional().nullable(),
  cusip: z.string().trim().max(12).optional().nullable(),
  isin: z.string().trim().max(15).optional().nullable(),
  name: z.string().trim().min(1).max(200).optional(),
  issuer: z.string().trim().max(200).optional().nullable(),
  sector_id: z.uuid().optional().nullable(),
  quantity: z.number().min(0).optional(),
  avg_cost: z.number().min(0).optional(),
  coupon_rate: z.number().min(0).max(30).optional().nullable(),
  maturity_date: z.string().date().optional().nullable(),
  issue_date: z.string().date().optional().nullable(),
  first_coupon_date: z.string().date().optional().nullable(),
  payment_frequency: z.number().int().min(1).max(12).optional().nullable(),
  day_count: z.enum(["30/360", "ACT/ACT", "ACT/360"]).optional().nullable(),
  rating: z.string().trim().max(10).optional().nullable(),
  duration: z.number().min(0).max(50).optional().nullable(),
  ytm: z.number().min(-5).max(50).optional().nullable(),
  pricing_method: z.enum(["live", "treasury_curve", "manual"]).optional(),
  benchmark_tenor: z.number().min(0).max(50).optional().nullable(),
  opened_on: z.string().date().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  is_active: z.boolean().optional(),
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
  if (!canExecute(ctx)) {
    return NextResponse.json(
      { error: "Only the PM, faculty advisor, or an app admin can manage holdings." },
      { status: 403 }
    );
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Invalid holding id." }, { status: 400 });
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
    .from("holdings")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "Holding not found." }, { status: 404 });
  }

  const update: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.symbol !== undefined && parsed.data.symbol !== null) {
    update.symbol = parsed.data.symbol.toUpperCase();
  }
  if (parsed.data.is_active === false && before.is_active) {
    update.closed_on = easternDateString();
  }
  if (parsed.data.is_active === true) {
    update.closed_on = null;
  }

  const { data, error } = await supabase
    .from("holdings")
    .update(update)
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
    action:
      parsed.data.is_active === false ? "holding.deactivate" : "holding.update",
    entity: "holdings",
    entityId: id,
    before,
    after: data,
  });

  return NextResponse.json({ holding: data });
}
