// /[fund]/trades (SPEC 11.2): pending tickets at the top (read-only cards for
// non-PM members, with a "Record execution" link for those who can execute),
// then the immutable trade ledger. Filters — symbol text, action, sector,
// date range — are searchParams-driven and applied on the server. Security
// and executor names are joined in via a holdings map and a profiles map
// (two extra queries); reversal rows are labeled "reverses trade …".

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { TicketCard, isBondInstrument } from "@/components/trades/TicketCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  formatBondPrice,
  formatCurrency,
  formatCurrencyWhole,
  formatDate,
  formatNumber,
} from "@/lib/format";
import type { Holding, Sector, Trade, TradeTicket } from "@/types/domain";

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

/** Date-only strings render at noon UTC so ET display never slips a day. */
function dateOnly(d: string | null): string {
  return d ? formatDate(`${d}T12:00:00Z`) : "—";
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

  const tickets = (ticketsRes.data as TradeTicket[]) ?? [];
  const allTrades = (tradesRes.data as Trade[]) ?? [];
  const holdings = (holdingsRes.data as HoldingLite[]) ?? [];
  const sectors = (sectorsRes.data as SectorLite[]) ?? [];

  const holdingById = new Map(holdings.map((h) => [h.id, h]));
  const sectorById = new Map(sectors.map((s) => [s.id, s]));

  // Joined names: profiles for executors + ticket creators, pitch titles.
  const profileIds = [
    ...new Set([
      ...allTrades.map((t) => t.executed_by),
      ...tickets.map((t) => t.created_by),
    ]),
  ];
  const pitchIds = [
    ...new Set(
      tickets
        .map((t) => t.pitch_id)
        .filter((id): id is string => id !== null)
    ),
  ];
  const [profilesRes, pitchesRes] = await Promise.all([
    profileIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", profileIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    pitchIds.length > 0
      ? supabase.from("pitches").select("id, title").in("id", pitchIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
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

  const mayExecute = canExecute(ctx);
  const selectClass =
    "cursor-pointer rounded-lg border border-input-border bg-input-bg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-highlight focus:outline-none";
  const inputClass =
    "rounded-lg border border-input-border bg-input-bg px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-accent";

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-bold sm:text-3xl">Trades</h1>
        <p className="text-xs text-muted">
          {trades.length === LEDGER_LIMIT
            ? `Most recent ${LEDGER_LIMIT} trades`
            : `${trades.length} ${trades.length === 1 ? "trade" : "trades"}`}
        </p>
      </div>

      {/* Pending tickets */}
      {tickets.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">
            Pending tickets ({tickets.length})
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {tickets.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                fund={ctx.fund.slug}
                sectorName={
                  ticket.sector_id
                    ? sectorById.get(ticket.sector_id)?.name ?? null
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
                      href={`/${ctx.fund.slug}/admin/tickets`}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
                    >
                      Record execution
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ) : (
                    <p className="text-xs text-muted">
                      Awaiting execution by the portfolio manager.
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
          hint="The ledger fills in when the portfolio manager executes a ticket — pass a pitch to create one, or the PM can create a ticket directly from Admin → Tickets."
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
              className="mt-2 inline-block text-sm font-medium text-accent hover:underline"
            >
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full" style={{ minWidth: 1000 }}>
              <thead>
                <tr className="border-b border-card-border text-[10px] uppercase tracking-wider text-muted sm:text-xs">
                  <th className="sticky left-0 top-0 z-30 bg-sticky px-3 py-2.5 text-left font-medium backdrop-blur-xl sm:px-6 sm:py-3">
                    Date
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-left font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Action
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-left font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Security
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-right font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Quantity
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-right font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Price
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-right font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Principal
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-right font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Accrued
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-right font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Commission
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-left font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Executed by
                  </th>
                  <th className="sticky top-0 z-20 bg-sticky px-2 py-2.5 text-left font-medium backdrop-blur-xl sm:px-4 sm:py-3">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const h = holdingById.get(t.holding_id);
                  const bond = h ? isBondInstrument(h.instrument_type) : false;
                  return (
                    <tr
                      key={t.id}
                      className="border-b border-card-border/50 transition-colors hover:bg-highlight"
                    >
                      <td className="sticky left-0 z-10 bg-sticky px-3 py-3 text-left text-xs tabular-nums backdrop-blur-xl sm:px-6 sm:py-3.5 sm:text-sm">
                        {dateOnly(t.trade_date)}
                      </td>
                      <td className="px-2 py-3 text-left sm:px-4">
                        <Badge tone={t.action === "buy" ? "gain" : "loss"}>
                          {t.action.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="px-2 py-3 text-left text-xs sm:px-4 sm:text-sm">
                        {h ? (
                          <Link
                            href={`/${ctx.fund.slug}/holdings/${h.id}`}
                            className="block hover:underline"
                          >
                            <span className="font-semibold">
                              {h.symbol ?? h.name}
                            </span>
                            {h.symbol && (
                              <span className="block max-w-[180px] truncate text-[10px] text-muted sm:text-xs">
                                {h.name}
                              </span>
                            )}
                          </Link>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-2 py-3 text-right text-xs tabular-nums sm:px-4 sm:text-sm">
                        {bond
                          ? formatCurrencyWhole(Number(t.quantity))
                          : formatNumber(Number(t.quantity))}
                      </td>
                      <td className="px-2 py-3 text-right text-xs tabular-nums sm:px-4 sm:text-sm">
                        {bond
                          ? formatBondPrice(Number(t.price))
                          : formatCurrency(Number(t.price))}
                      </td>
                      <td className="px-2 py-3 text-right text-xs font-medium tabular-nums sm:px-4 sm:text-sm">
                        {formatCurrency(Number(t.amount))}
                      </td>
                      <td className="px-2 py-3 text-right text-xs tabular-nums text-muted sm:px-4 sm:text-sm">
                        {Number(t.accrued_interest) !== 0
                          ? formatCurrency(Number(t.accrued_interest))
                          : "—"}
                      </td>
                      <td className="px-2 py-3 text-right text-xs tabular-nums text-muted sm:px-4 sm:text-sm">
                        {Number(t.commission) !== 0
                          ? formatCurrency(Number(t.commission))
                          : "—"}
                      </td>
                      <td className="px-2 py-3 text-left text-xs text-muted sm:px-4 sm:text-sm">
                        <span className="block max-w-[140px] truncate">
                          {nameById.get(t.executed_by) ?? "—"}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-left text-xs text-muted sm:px-4 sm:text-sm">
                        <div className="max-w-[240px] space-y-1">
                          {t.reverses_trade_id && (
                            <Badge
                              tone="warn"
                              title={`This correction row reverses trade ${t.reverses_trade_id}`}
                            >
                              reverses trade {t.reverses_trade_id.slice(0, 8)}
                            </Badge>
                          )}
                          {t.notes && (
                            <span className="block truncate" title={t.notes}>
                              {t.notes}
                            </span>
                          )}
                          {!t.reverses_trade_id && !t.notes && "—"}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
