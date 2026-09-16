// /[fund]/admin/tickets (SPEC 11.3): PM / faculty advisor / app admin only.
// Each pending ticket renders with the record-execution form (fill fields +
// preview of holding and cash after, cancel with reason), and a direct
// no-pitch ticket can be created below for rebalances, corporate actions, or
// advisor-directed trades (reason required).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TicketCard } from "@/components/trades/TicketCard";
import { ExecuteTicketForm } from "@/components/trades/ExecuteTicketForm";
import { CreateTicketForm } from "@/components/trades/CreateTicketForm";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatCurrency } from "@/lib/format";
import type { Holding, TradeTicket } from "@/types/domain";

export const metadata: Metadata = { title: "Trade Tickets" };

type HoldingPosition = Pick<Holding, "id" | "quantity" | "avg_cost">;

export default async function AdminTicketsPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx || !canExecute(ctx)) notFound();

  const supabase = await createSupabaseServerClient();

  const [ticketsRes, sectorsRes] = await Promise.all([
    supabase
      .from("trade_tickets")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("sectors")
      .select("id, name")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  const tickets = (ticketsRes.data as TradeTicket[]) ?? [];
  const sectors = (sectorsRes.data as { id: string; name: string }[]) ?? [];
  const sectorNameById = new Map(sectors.map((s) => [s.id, s.name]));

  // Joins for the cards: current positions (preview baseline), pitch titles,
  // creator names.
  const holdingIds = [
    ...new Set(
      tickets.map((t) => t.holding_id).filter((id): id is string => id !== null)
    ),
  ];
  const pitchIds = [
    ...new Set(
      tickets.map((t) => t.pitch_id).filter((id): id is string => id !== null)
    ),
  ];
  const creatorIds = [...new Set(tickets.map((t) => t.created_by))];

  const [holdingsRes, pitchesRes, profilesRes] = await Promise.all([
    holdingIds.length > 0
      ? supabase
          .from("holdings")
          .select("id, quantity, avg_cost")
          .in("id", holdingIds)
      : Promise.resolve({ data: [] as HoldingPosition[] }),
    pitchIds.length > 0
      ? supabase.from("pitches").select("id, title").in("id", pitchIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    creatorIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", creatorIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);

  const positionById = new Map(
    ((holdingsRes.data as HoldingPosition[]) ?? []).map((h) => [h.id, h])
  );
  const pitchTitleById = new Map(
    ((pitchesRes.data as { id: string; title: string }[]) ?? []).map((p) => [
      p.id,
      p.title,
    ])
  );
  const nameById = new Map(
    ((profilesRes.data as { id: string; full_name: string }[]) ?? []).map(
      (p) => [p.id, p.full_name]
    )
  );

  const cashBalance = Number(ctx.fund.cash_balance);

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">Trade tickets</h1>
        <p className="text-xs text-muted tabular-nums">
          Cash available: {formatCurrency(cashBalance)}
        </p>
      </div>

      {tickets.length === 0 ? (
        <EmptyState
          title="No pending tickets"
          hint="Tickets appear here when a pitch passes its vote. For a rebalance, corporate action, or advisor-directed trade, create one directly below."
        />
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => {
            const position = ticket.holding_id
              ? positionById.get(ticket.holding_id)
              : undefined;
            return (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                fund={ctx.fund.slug}
                sectorName={
                  ticket.sector_id
                    ? sectorNameById.get(ticket.sector_id) ?? null
                    : null
                }
                pitchTitle={
                  ticket.pitch_id
                    ? pitchTitleById.get(ticket.pitch_id) ?? null
                    : null
                }
                createdByName={nameById.get(ticket.created_by) ?? null}
                footer={
                  <ExecuteTicketForm
                    fund={ctx.fund.slug}
                    ticketId={ticket.id}
                    action={ticket.action}
                    instrumentType={ticket.instrument_type}
                    holdingQuantity={
                      position ? Number(position.quantity) : 0
                    }
                    holdingAvgCost={position ? Number(position.avg_cost) : 0}
                    cashBalance={cashBalance}
                    estQuantity={
                      ticket.est_quantity !== null
                        ? Number(ticket.est_quantity)
                        : null
                    }
                    estPrice={
                      ticket.est_price !== null
                        ? Number(ticket.est_price)
                        : null
                    }
                  />
                }
              />
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader title="Create a ticket (no pitch)" />
        <div className="p-4 sm:p-6">
          <p className="mb-4 text-sm text-muted">
            For rebalances, corporate actions, or advisor-directed trades that
            do not come from a pitch. A reason is required and is kept on the
            ticket.
          </p>
          <CreateTicketForm
            fund={ctx.fund.slug}
            sectors={sectors}
            defaultInstrumentType={
              ctx.fund.asset_class === "equity" ? "equity" : "treasury"
            }
          />
        </div>
      </Card>
    </div>
  );
}
