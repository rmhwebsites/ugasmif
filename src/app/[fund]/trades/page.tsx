// /[fund]/trades (SPEC 11.2): pending tickets at the top (read-only cards for
// non-PM members, with a "Record execution" link for those who can execute
// that opens that ticket's form on Manage tickets), then the immutable trade
// ledger. Filters — symbol text, action, sector, date range — are
// searchParams-driven and applied on the server. Security and executor names
// are joined in via a holdings map and a profiles map, and a trade filled
// from a pitch's ticket carries that pitch's title; reversal rows are labeled
// "reverses trade …".

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TicketCard } from "@/components/trades/TicketCard";
import { TradeLedgerTable } from "@/components/tables/TradeLedgerTable";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Holding, Sector, Trade, TradeTicket } from "@/types/domain";
import { ManageLink, PageHeader } from "@/components/ui/PageHeader";

/** A filled ticket, read for the pitch behind a ledger row. */
type LedgerTicket = {
  id: string;
  pitch_id: string | null;
  pitches: { id: string; title: string } | null;
};

export const metadata: Metadata = { title: "Trades" };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LEDGER_LIMIT = 500;

type HoldingLite = Pick<
  Holding,
  "id" | "name" | "symbol" | "instrument_type" | "sector_id"
>;
type SectorLite = Pick<Sector, "id" | "name" | "slug">;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function TradesPage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const sp = await searchParams;
  const symbolQ = first(sp.symbol).trim();
  const actionRaw = first(sp.action);
  const actionQ = actionRaw === "buy" || actionRaw === "sell" ? actionRaw : "";
  const sectorQ = first(sp.sector);
  const fromQ = DATE_RE.test(first(sp.from)) ? first(sp.from) : "";
  const toQ = DATE_RE.test(first(sp.to)) ? first(sp.to) : "";
  const filtering = Boolean(symbolQ || actionQ || sectorQ || fromQ || toQ);

  const supabase = await createSupabaseServerClient();

  // Ledger query — action and date range filter server-side in SQL.
  let tradesQuery = supabase
    .from("trades")
    .select("*")
    .eq("fund_id", ctx.fund.id)
    .order("trade_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LEDGER_LIMIT);
  if (actionQ) tradesQuery = tradesQuery.eq("action", actionQ);
  if (fromQ) tradesQuery = tradesQuery.gte("trade_date", fromQ);
  if (toQ) tradesQuery = tradesQuery.lte("trade_date", toQ);

  const [ticketsRes, tradesRes, holdingsRes, sectorsRes] = await Promise.all([
    supabase
      .from("trade_tickets")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    tradesQuery,
    supabase
      .from("holdings")
      .select("id, name, symbol, instrument_type, sector_id")
      .eq("fund_id", ctx.fund.id),
    supabase
      .from("sectors")
      .select("id, name, slug")
      .eq("fund_id", ctx.fund.id)
      .order("sort_order"),
  ]);

  const allTickets = (ticketsRes.data as TradeTicket[]) ?? [];
  const allTrades = (tradesRes.data as Trade[]) ?? [];
  const holdings = (holdingsRes.data as HoldingLite[]) ?? [];
  const sectors = (sectorsRes.data as SectorLite[]) ?? [];

  const holdingById = new Map(holdings.map((h) => [h.id, h]));
  const sectorById = new Map(sectors.map((s) => [s.id, s]));

  // Joined names: profiles for executors + ticket creators, pitch titles.
  const profileIds = [
    ...new Set([
      ...allTrades.map((t) => t.executed_by),
      ...allTickets.map((t) => t.created_by),
    ]),
  ];
  const pitchIds = [
    ...new Set(
      allTickets
        .map((t) => t.pitch_id)
        .filter((id): id is string => id !== null)
    ),
  ];
  // Trades filled from a ticket: the ticket names the pitch, if any.
  const ledgerTicketIds = [
    ...new Set(
      allTrades
        .map((t) => t.ticket_id)
        .filter((id): id is string => id !== null)
    ),
  ];
  const [profilesRes, pitchesRes, ledgerTicketsRes] = await Promise.all([
    profileIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", profileIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    pitchIds.length > 0
      ? supabase.from("pitches").select("id, title").in("id", pitchIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    ledgerTicketIds.length > 0
      ? supabase
          .from("trade_tickets")
          .select("id, pitch_id, pitches(id, title)")
          .in("id", ledgerTicketIds)
      : Promise.resolve({ data: [] as LedgerTicket[] }),
  ]);
  const nameById = new Map(
    ((profilesRes.data as { id: string; full_name: string }[]) ?? []).map(
      (p) => [p.id, p.full_name]
    )
  );
  const pitchTitleById = new Map(
    ((pitchesRes.data as { id: string; title: string }[]) ?? []).map((p) => [
      p.id,
      p.title,
    ])
  );
  const pitchByTicketId = new Map(
    ((ledgerTicketsRes.data as unknown as LedgerTicket[]) ?? []).flatMap((t) =>
      t.pitches ? [[t.id, t.pitches] as const] : []
    )
  );

  // Symbol text and sector filters need the holding join, so they apply here.
  const sectorFilterId = sectorQ
    ? sectors.find((s) => s.slug === sectorQ)?.id ?? "__none__"
    : null;
  const needle = symbolQ.toLowerCase();
  const trades = allTrades.filter((t) => {
    const h = holdingById.get(t.holding_id);
    if (needle) {
      const hay = `${h?.symbol ?? ""} ${h?.name ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (sectorFilterId && h?.sector_id !== sectorFilterId) return false;
    return true;
  });
  // The symbol, action and sector filters narrow the pending tickets too, so
  // a filtered view doesn't open on tickets for other securities. A pending
  // ticket has no trade date yet, so the date range leaves them alone.
  const tickets = allTickets.filter((t) => {
    if (needle) {
      const hay = `${t.symbol ?? ""} ${t.name ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    if (actionQ && t.action !== actionQ) return false;
    if (sectorFilterId) {
      const sectorId =
        t.sector_id ??
        (t.holding_id ? holdingById.get(t.holding_id)?.sector_id : null);
      if (sectorId !== sectorFilterId) return false;
    }
    return true;
  });

  const mayExecute = canExecute(ctx);
  const selectClass =
    "cursor-pointer rounded-lg border border-input-border bg-input-bg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-highlight focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-text";
  const inputClass =
    "rounded-lg border border-input-border bg-input-bg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trades"
        description={`Pending tickets, then the ledger of every trade. ${
          trades.length === LEDGER_LIMIT
            ? `Showing the most recent ${LEDGER_LIMIT}.`
            : `${trades.length} ${trades.length === 1 ? "trade" : "trades"} so far.`
        }`}
        actions={
          mayExecute ? (
            <ManageLink href={`/${ctx.fund.slug}/admin/tickets`}>
              Manage tickets
            </ManageLink>
          ) : undefined
        }
      />

      {/* Pending tickets */}
      {tickets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Pending tickets
            <span className="ml-2 text-sm font-normal text-muted tabular-nums">
              {tickets.length}
            </span>
          </h2>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                id={`ticket-${ticket.id}`}
                ticket={ticket}
                fund={ctx.fund.slug}
                sectorName={
                  ticket.sector_id
                    ? sectorById.get(ticket.sector_id)?.name ?? null
                    : null
                }
                sectorSlug={
                  ticket.sector_id
                    ? sectorById.get(ticket.sector_id)?.slug ?? null
                    : null
                }
                pitchTitle={
                  ticket.pitch_id
                    ? pitchTitleById.get(ticket.pitch_id) ?? null
                    : null
                }
                createdByName={nameById.get(ticket.created_by) ?? null}
                footer={
                  mayExecute ? (
                    <Link
                      href={`/${ctx.fund.slug}/admin/tickets#ticket-${ticket.id}`}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
                    >
                      Record execution
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ) : (
                    <p className="text-xs text-muted">
                      Waiting to be executed by the portfolio manager.
                    </p>
                  )
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Ledger */}
      {trades.length === 0 && !filtering ? (
        <EmptyState
          title="No trades yet"
          hint={
            mayExecute
              ? "The ledger fills in as tickets are executed. A pitch that passes its vote creates a ticket, or you can create one directly."
              : "The ledger fills in when the portfolio manager executes a ticket. A pitch that passes its vote creates a ticket."
          }
          action={
            mayExecute ? (
              <ManageLink href={`/${ctx.fund.slug}/admin/tickets`}>
                Manage tickets
              </ManageLink>
            ) : undefined
          }
        />
      ) : (
      <div className="glass-card overflow-hidden">
        <form
          method="get"
          action={`/${ctx.fund.slug}/trades`}
          className="flex flex-wrap items-center gap-2 border-b border-card-border px-4 py-3 sm:px-6"
        >
          <input
            type="text"
            name="symbol"
            defaultValue={symbolQ}
            placeholder="Symbol or name"
            aria-label="Filter by symbol or name"
            className={`${inputClass} w-36`}
          />
          <select
            name="action"
            defaultValue={actionQ}
            aria-label="Filter by action"
            className={selectClass}
          >
            <option value="">All actions</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
          <select
            name="sector"
            defaultValue={sectorQ}
            aria-label="Filter by sector"
            className={selectClass}
          >
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.slug}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            name="from"
            defaultValue={fromQ}
            aria-label="From date"
            className={inputClass}
          />
          <input
            type="date"
            name="to"
            defaultValue={toQ}
            aria-label="To date"
            className={inputClass}
          />
          <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs">
            Apply
          </Button>
          {filtering && (
            <Link
              href={`/${ctx.fund.slug}/trades`}
              className="text-xs text-muted hover:text-foreground"
            >
              Clear
            </Link>
          )}
        </form>

        {trades.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-muted">No trades match these filters.</p>
            <Link
              href={`/${ctx.fund.slug}/trades`}
              className="mt-2 inline-block text-sm font-medium text-accent-text hover:underline"
            >
              Clear filters
            </Link>
          </div>
        ) : (
          <TradeLedgerTable
            fund={ctx.fund.slug}
            trades={trades.map((t) => {
              const h = holdingById.get(t.holding_id);
              return {
                ...t,
                holding: h
                  ? {
                      id: h.id,
                      symbol: h.symbol,
                      name: h.name,
                      instrument_type: h.instrument_type,
                    }
                  : null,
                executedByName: nameById.get(t.executed_by) ?? null,
                pitch: t.ticket_id
                  ? pitchByTicketId.get(t.ticket_id) ?? null
                  : null,
              };
            })}
          />
        )}
      </div>
      )}
    </div>
  );
}
