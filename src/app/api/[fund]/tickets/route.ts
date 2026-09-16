// POST /api/[fund]/tickets — create a direct (no-pitch) pending trade ticket
// (SPEC 11.3, 12): rebalances, corporate actions, advisor-directed trades.
// canExecute-gated, zod-validated, reason required (stored in notes), and
// audit-logged as 'ticket.create'. When the symbol/CUSIP matches an active
// holding the ticket is linked to it so the fill merges into the position —
// which also makes sell tickets executable (the execute RPC requires a
// holding on sells).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { Holding, TradeTicket } from "@/types/domain";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["buy", "sell"]),
  instrument_type: z.enum([
    "equity",
    "etf",
    "treasury",
    "corporate",
    "agency_mbs",
    "municipal",
    "money_market",
  ]),
  symbol: z.string().trim().min(1).max(12).optional(),
  cusip: z.string().trim().min(1).max(12).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  sector_id: z.uuid().optional(),
  est_quantity: z.number().positive().optional(),
  est_price: z.number().positive().optional(),
  est_amount: z.number().positive().optional(),
  reason: z
    .string()
    .trim()
    .min(1, "A reason is required for a direct ticket."),
});

type HoldingMatch = Pick<
  Holding,
  "id" | "name" | "symbol" | "cusip" | "sector_id" | "instrument_type"
>;

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
      {
        error:
          "Only the portfolio manager, faculty advisor, or an app admin can create trade tickets.",
      },
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
  const body = parsed.data;

  if (!body.symbol && !body.name) {
    return NextResponse.json(
      {
        error:
          "Provide a symbol (listed securities) or a name (bonds and unlisted).",
      },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();

  // Link an existing active holding by symbol (case-insensitive) or CUSIP.
  let holding: HoldingMatch | null = null;
  const matchCols = "id, name, symbol, cusip, sector_id, instrument_type";
  if (body.symbol) {
    const { data } = await supabase
      .from("holdings")
      .select(matchCols)
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .ilike("symbol", body.symbol)
      .limit(1);
    holding = ((data as HoldingMatch[]) ?? [])[0] ?? null;
  }
  if (!holding && body.cusip) {
    const { data } = await supabase
      .from("holdings")
      .select(matchCols)
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .ilike("cusip", body.cusip)
      .limit(1);
    holding = ((data as HoldingMatch[]) ?? [])[0] ?? null;
  }

  if (body.action === "sell" && !holding) {
    return NextResponse.json(
      {
        error:
          "Sell tickets must match an existing active holding — no position matches that symbol or CUSIP.",
      },
      { status: 400 }
    );
  }

  const symbol = body.symbol?.toUpperCase() ?? holding?.symbol ?? null;
  const insert = {
    fund_id: ctx.fund.id,
    pitch_id: null,
    holding_id: holding?.id ?? null,
    created_by: ctx.profile.id,
    action: body.action,
    // Keep the linked holding's type so bond vs equity principal math on
    // execute matches the actual position.
    instrument_type: holding?.instrument_type ?? body.instrument_type,
    symbol,
    cusip: body.cusip?.toUpperCase() ?? holding?.cusip ?? null,
    name: body.name ?? holding?.name ?? symbol ?? "Unnamed security",
    sector_id: body.sector_id ?? holding?.sector_id ?? null,
    est_quantity: body.est_quantity ?? null,
    est_price: body.est_price ?? null,
    est_amount: body.est_amount ?? null,
    notes: `Direct ticket — reason: ${body.reason}`,
  };

  const { data, error } = await supabase
    .from("trade_tickets")
    .insert(insert)
    .select("*")
    .single();
  if (error) {
    return NextResponse.json(
      { error: `Could not create the ticket: ${error.message}` },
      { status: 400 }
    );
  }
  const ticket = data as TradeTicket;

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "ticket.create",
    entity: "trade_tickets",
    entityId: ticket.id,
    after: ticket,
  });

  return NextResponse.json({ ticket }, { status: 201 });
}
