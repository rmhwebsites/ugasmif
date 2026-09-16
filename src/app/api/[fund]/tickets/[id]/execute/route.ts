// POST /api/[fund]/tickets/[id]/execute — record the fill on a pending
// ticket (SPEC 11.3, 12). canExecute-gated, zod-validated, then everything
// atomic happens inside the execute_ticket RPC (ticket update + ledger row +
// holding upsert + cash + audit). On success: "Trade executed" email to the
// whole fund (essential, per Section 16) and a fire-and-forget append to the
// Google Sheets Trades tab. RPC errors come back as a clean 400.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendToFund } from "@/lib/emails/send";
import { appendTradeRow } from "@/lib/sheets/backup";
import {
  formatBondPrice,
  formatCurrency,
  formatCurrencyWhole,
  formatNumber,
} from "@/lib/format";
import type { Trade, TradeTicket } from "@/types/domain";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const bodySchema = z.object({
  fill_quantity: z
    .number({ error: "Fill quantity must be a number." })
    .positive("Fill quantity must be positive."),
  fill_price: z
    .number({ error: "Fill price must be a number." })
    .positive("Fill price must be positive."),
  accrued_interest: z.number().min(0).default(0),
  commission: z.number().min(0).default(0),
  trade_date: z
    .string({ error: "Trade date is required." })
    .regex(DATE_RE, "Trade date must be YYYY-MM-DD."),
  settlement_date: z
    .string()
    .regex(DATE_RE, "Settlement date must be YYYY-MM-DD.")
    .nullish(),
  broker_reference: z.string().trim().max(120).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const BOND_TYPES = new Set(["treasury", "corporate", "agency_mbs", "municipal"]);

/** Strip the internal function prefixes off RPC error messages. */
function cleanRpcError(message: string): string {
  return message.replace(/^(execute_ticket|apply_trade):\s*/, "");
}

export async function POST(
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
      {
        error:
          "Only the portfolio manager, faculty advisor, or an app admin can execute trades.",
      },
      { status: 403 }
    );
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
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

  const supabase = await createSupabaseServerClient();

  // The ticket must belong to this fund's URL, and pre-fetching gives the
  // email its security details.
  const { data: ticketRow } = await supabase
    .from("trade_tickets")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  const ticket = (ticketRow as TradeTicket) ?? null;
  if (!ticket) {
    return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  }
  if (ticket.status !== "pending") {
    return NextResponse.json(
      { error: `Ticket is ${ticket.status}; only pending tickets can be executed.` },
      { status: 400 }
    );
  }

  // Atomic execute: ticket + ledger + holding + cash + audit in one RPC.
  const { data: tradeId, error } = await supabase.rpc("execute_ticket", {
    p_ticket_id: id,
    p_fill_quantity: body.fill_quantity,
    p_fill_price: body.fill_price,
    p_accrued_interest: body.accrued_interest,
    p_commission: body.commission,
    p_trade_date: body.trade_date,
    p_settlement_date: body.settlement_date ?? null,
    p_broker_reference: body.broker_reference ?? null,
    p_notes: body.notes ?? null,
  });
  if (error) {
    return NextResponse.json(
      { error: cleanRpcError(error.message) },
      { status: 400 }
    );
  }

  // "Trade executed: Bought 120 GD at $312.40" — essential, whole fund.
  const bond = BOND_TYPES.has(ticket.instrument_type);
  const verb = ticket.action === "buy" ? "Bought" : "Sold";
  const label = ticket.symbol ?? ticket.name;
  const qtyStr = bond
    ? `${formatCurrencyWhole(body.fill_quantity)} face`
    : formatNumber(
        body.fill_quantity,
        Number.isInteger(body.fill_quantity) ? 0 : 2
      );
  const priceStr = bond
    ? formatBondPrice(body.fill_price)
    : formatCurrency(body.fill_price);
  const principal = bond
    ? (body.fill_quantity * body.fill_price) / 100
    : body.fill_quantity * body.fill_price;
  const bodyLines = [
    `${verb} ${qtyStr} of ${ticket.name}${
      ticket.symbol ? ` (${ticket.symbol})` : ""
    } at ${priceStr} on ${body.trade_date}.`,
    `Principal ${formatCurrency(principal)}${
      bond && body.accrued_interest > 0
        ? `, accrued interest ${formatCurrency(body.accrued_interest)}`
        : ""
    }${
      body.commission > 0
        ? `, commission ${formatCurrency(body.commission)}`
        : ""
    }.`,
  ];
  await sendToFund(supabase, ctx.fund.id, {
    subject: `Trade executed: ${verb} ${qtyStr} ${label} at ${priceStr}`,
    heading: `${verb} ${label}`,
    bodyLines,
    ctaLabel: "View the ledger",
    ctaPath: `/${ctx.fund.slug}/trades`,
    essential: true,
  });

  // Real-time append to the Sheets Trades tab — fire-and-forget, never
  // blocks or fails the response (appendTradeRow itself never throws).
  const { data: tradeRow } = await supabase
    .from("trades")
    .select("*")
    .eq("id", tradeId as string)
    .maybeSingle();
  const trade = (tradeRow as Trade) ?? null;
  if (trade) {
    let holdingName = ticket.name;
    const { data: holdingRow } = await supabase
      .from("holdings")
      .select("name")
      .eq("id", trade.holding_id)
      .maybeSingle();
    if (holdingRow) holdingName = (holdingRow as { name: string }).name;
    void appendTradeRow(ctx.fund.slug, trade, holdingName);
  }

  return NextResponse.json({ trade_id: tradeId as string });
}
