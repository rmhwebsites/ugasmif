// POST /api/[fund]/cash-movements — record dividends, coupons,
// contributions, fees (SPEC 11.3). The signed amount also adjusts
// funds.cash_balance. canExecute-gated, audit-logged.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  kind: z.enum([
    "contribution",
    "withdrawal",
    "dividend",
    "coupon",
    "interest",
    "fee",
    "adjustment",
  ]),
  amount: z
    .number()
    .refine((n) => n !== 0, { message: "Amount can't be zero." }),
  holding_id: z.uuid().optional().nullable(),
  occurred_on: z.string().date(),
  notes: z.string().max(1000).optional().nullable(),
});

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
      { error: "Only the PM, faculty advisor, or an app admin can record cash movements." },
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
  if (parsed.data.holding_id) {
    const { data: holding } = await supabase
      .from("holdings")
      .select("id")
      .eq("id", parsed.data.holding_id)
      .eq("fund_id", ctx.fund.id)
      .maybeSingle();
    if (!holding) {
      return NextResponse.json(
        { error: "Holding not found in this fund." },
        { status: 404 }
      );
    }
  }

  const { data, error } = await supabase
    .from("cash_movements")
    .insert({
      fund_id: ctx.fund.id,
      kind: parsed.data.kind,
      amount: parsed.data.amount,
      holding_id: parsed.data.holding_id ?? null,
      occurred_on: parsed.data.occurred_on,
      recorded_by: ctx.profile.id,
      notes: parsed.data.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Move the fund's cash. Two statements, not atomic — acceptable for an
  // app where one PM records a handful of these per month.
  const newBalance = Number(ctx.fund.cash_balance) + parsed.data.amount;
  const { error: cashError } = await supabase
    .from("funds")
    .update({ cash_balance: newBalance })
    .eq("id", ctx.fund.id);
  if (cashError) {
    return NextResponse.json(
      {
        error: `Movement recorded but the cash balance update failed: ${cashError.message}. Adjust cash manually.`,
      },
      { status: 500 }
    );
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "cash.movement",
    entity: "cash_movements",
    entityId: data.id as string,
    after: { ...data, new_cash_balance: newBalance },
  });

  return NextResponse.json({ movement: data, cash_balance: newBalance });
}
