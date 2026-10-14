// /[fund]/admin/tickets (SPEC 11.3): PM / faculty advisor / app admin only.
// Each pending ticket renders with the record-execution form (fill fields +
// preview of holding and cash after, cancel with reason) inside a wrapper
// with id="ticket-<id>", so links from the dashboard, Trades and a pitch's
// outcome land on the one they name. Below, a direct ticket (no pitch) buys,
// sells or closes a position, or covers a rebalance, corporate action or
// advisor-directed trade (reason required). ?action=sell&holding=<id> opens
// that form with the holding chosen and its full quantity filled in.

import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TicketCard } from "@/components/trades/TicketCard";
import { ExecuteTicketForm } from "@/components/trades/ExecuteTicketForm";
import {
  CreateTicketForm,
  type TicketHolding,
} from "@/components/trades/CreateTicketForm";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, ViewLink } from "@/components/ui/PageHeader";
import { formatCurrency } from "@/lib/format";
import type { Holding, TradeAction, TradeTicket } from "@/types/domain";
import { adminTitle } from "../admin-metadata";

export const generateMetadata = adminTitle("tickets", "Manage tickets");

type HoldingPosition = Pick<Holding, "id" | "quantity" | "avg_cost">;

export default async function AdminTicketsPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{ action?: string; holding?: string }>;
}) {
  const { fund: slug } = await params;
  const query = await searchParams;
  const ctx = await getFundContext(slug);
  if (!ctx || !canExecute(ctx)) notFound();

  const supabase = await createSupabaseServerClient();

  const [ticketsRes, sectorsRes, activeRes] = await Promise.all([
    supabase
      .from("trade_tickets")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase
      .from("sectors")
      .select("id, name, slug")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("sort_order"),
    // Active positions for the new-ticket form's holding picker.
    supabase
      .from("holdings")
      .select("id, name, symbol, cusip, sector_id, instrument_type, quantity")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("name"),
  ]);

  const tickets = (ticketsRes.data as TradeTicket[]) ?? [];
  const sectors =
    (sectorsRes.data as { id: string; name: string; slug: string }[]) ?? [];
  const sectorById = new Map(sectors.map((s) => [s.id, s]));
  const activeHoldings = ((activeRes.data as TicketHolding[]) ?? []).sort(
    (a, b) => (a.symbol ?? a.name).localeCompare(b.symbol ?? b.name)
  );

  const prefillAction: TradeAction | undefined =
    query.action === "sell" || query.action === "buy" ? query.action : undefined;
  const prefillHolding = activeHoldings.some((h) => h.id === query.holding)
    ? query.holding
    : null;

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
      <PageHeader
        title="Manage tickets"
        description={
          <>
            Record execution for pending tickets, or create a ticket to buy,
            sell or close a position. Cash available:{" "}
            <span className="tabular-nums">{formatCurrency(cashBalance)}</span>
          </>
        }
        actions={
          <ViewLink href={`/${ctx.fund.slug}/trades`}>View trades</ViewLink>
        }
      />

      <section aria-labelledby="pending-tickets" className="space-y-3">
        <h2
          id="pending-tickets"
          className="text-base font-semibold sm:text-lg"
        >
          Pending tickets
          {tickets.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted tabular-nums">
              {tickets.length}
            </span>
          )}
        </h2>

        {tickets.length === 0 ? (
          <EmptyState
            title="No pending tickets"
            hint="Tickets appear here when a pitch passes its vote. To sell or close a position, or for a rebalance, corporate action or advisor-directed trade, create one below."
          />
        ) : (
          <div className="space-y-4">
            {tickets.map((ticket) => {
              const position = ticket.holding_id
                ? positionById.get(ticket.holding_id)
                : undefined;
              const sector = ticket.sector_id
                ? sectorById.get(ticket.sector_id)
                : undefined;
              return (
                // The anchor that "Record execution" links point at. The
                // ring marks the ticket you came for.
                <div
                  key={ticket.id}
                  id={`ticket-${ticket.id}`}
                  className="scroll-mt-20 rounded-2xl target:ring-2 target:ring-accent-text lg:scroll-mt-6"
                >
                  <TicketCard
                    ticket={ticket}
                    fund={ctx.fund.slug}
                    sectorName={sector?.name ?? null}
                    sectorSlug={sector?.slug ?? null}
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
                        holdingAvgCost={
                          position ? Number(position.avg_cost) : 0
                        }
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
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Card>
        <div id="new-ticket" className="scroll-mt-20 lg:scroll-mt-6">
          <CardHeader title="New trade ticket (buy, sell or close a position)" />
        </div>
        <div className="p-4 sm:p-6">
          <p className="mb-4 text-sm text-muted">
            For trades that don&apos;t come from a pitch: selling or closing a
            position, rebalances, corporate actions, or advisor-directed
            trades. Recording the execution updates the holding and the
            fund&apos;s cash. A reason is required and is kept on the ticket.
          </p>
          <CreateTicketForm
            fund={ctx.fund.slug}
            sectors={sectors}
            defaultInstrumentType={
              ctx.fund.asset_class === "equity" ? "equity" : "treasury"
            }
            holdings={activeHoldings}
            initial={{ action: prefillAction, holdingId: prefillHolding }}
          />
        </div>
      </Card>
    </div>
  );
}
