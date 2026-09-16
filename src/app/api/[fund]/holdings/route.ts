// POST /api/[fund]/holdings — add a holding directly (SPEC 11.3
// /admin/holdings). canExecute-gated, audit-logged.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    instrument_type: z.enum([
      "equity",
      "etf",
      "treasury",
      "corporate",
      "agency_mbs",
      "municipal",
      "money_market",
    ]),
    symbol: z.string().trim().max(12).optional().nullable(),
    cusip: z.string().trim().max(12).optional().nullable(),
    isin: z.string().trim().max(15).optional().nullable(),
    name: z.string().trim().min(1).max(200),
    issuer: z.string().trim().max(200).optional().nullable(),
    sector_id: z.uuid().optional().nullable(),
    quantity: z.number().min(0),
    avg_cost: z.number().min(0),
    coupon_rate: z.number().min(0).max(30).optional().nullable(),
    maturity_date: z.string().date().optional().nullable(),
    issue_date: z.string().date().optional().nullable(),
    first_coupon_date: z.string().date().optional().nullable(),
    payment_frequency: z.number().int().min(1).max(12).optional().nullable(),
    day_count: z.enum(["30/360", "ACT/ACT", "ACT/360"]).optional().nullable(),
    rating: z.string().trim().max(10).optional().nullable(),
    duration: z.number().min(0).max(50).optional().nullable(),
    ytm: z.number().min(-5).max(50).optional().nullable(),
    pricing_method: z.enum(["live", "treasury_curve", "manual"]),
    benchmark_tenor: z.number().min(0).max(50).optional().nullable(),
    opened_on: z.string().date().optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .refine(
    (b) =>
      !["equity", "etf"].includes(b.instrument_type) ||
      (b.symbol && b.symbol.length > 0),
    { message: "Equities and ETFs need a Yahoo symbol." }
  )
  .refine(
    (b) => b.pricing_method !== "live" || b.symbol || b.instrument_type === "money_market",
    { message: "Live pricing needs a symbol (money market may omit it)." }
  );

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
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
  const { data, error } = await supabase
    .from("holdings")
    .insert({
      ...parsed.data,
      symbol: parsed.data.symbol ? parsed.data.symbol.toUpperCase() : null,
      fund_id: ctx.fund.id,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "holding.create",
    entity: "holdings",
    entityId: data.id as string,
    after: data,
  });

  return NextResponse.json({ holding: data });
}
