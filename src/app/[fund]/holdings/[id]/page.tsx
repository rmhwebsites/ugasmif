// /[fund]/holdings/[id] — position detail (SPEC 11.2). Server component.
//
// Equities/ETFs: Lightweight Charts price chart (1D…ALL) via the StockChart
// client component, key stats from quoteSummary (server-side getKeyStats),
// position history (every trade in this name), and pitches referencing it.
//
// Bonds: mark history (table + clean-price line via the shared ValueChart),
// remaining cash-flow schedule from couponSchedule, the Treasury spread at
// each mark when curve data exists (mark YTM − interpolated par yield at the
// holding's benchmark_tenor on the nearest prior curve date; skipped when
// unavailable), a FINRA TRACE lookup link, and pitches.
//
// The page is also the hub between a pitch, its ticket and the position:
// pending tickets for this security sit under the stats, each trade in the
// history links to the pitch behind it, and the pitches card lists every
// pitch on it. The people who run the book get its actions in the header
// (Enter mark, Sell or close, Manage holdings); everyone else gets plain
// sentences in place of admin directions.
//
// The holding is located inside valueFund's output — an id that is not an
// active holding of THIS fund is a notFound().

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  ArrowRightLeft,
  ExternalLink,
  PencilLine,
} from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { getKeyStats } from "@/lib/yahoo";
import { couponSchedule } from "@/lib/bonds/accrued";
import { interpolateYield } from "@/lib/bonds/treasury";
import { StockChart } from "@/components/holdings/StockChart";
import { KeyStatsCard } from "@/components/holdings/KeyStats";
import {
  PriceSourceBadge,
  stalePriceReason,
} from "@/components/holdings/PriceSourceBadge";
import { ValueChart } from "@/components/charts/ValueChart";
import { TicketCard } from "@/components/trades/TicketCard";
import { AlumniNotice } from "@/components/ui/AlumniNotice";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge, PitchStatusBadge } from "@/components/ui/Badge";
import {
  LinkButton,
  ManageLink,
  PageHeader,
} from "@/components/ui/PageHeader";
import { SectorLink } from "@/components/ui/SectorLink";
import { SecurityLogo } from "@/components/holdings/SecurityLogo";
import {
  HoldingTradesTable,
  MarkHistoryTable,
  type TradePitch,
} from "@/components/tables/HoldingDetailTables";
import {
  easternDateString,
  formatBondPrice,
  formatCurrency,
  formatCurrencyWhole,
  formatDate,
  formatNumber,
  formatPercent,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/format";
import type {
  BondMark,
  ChartPoint,
  FundSlug,
  Holding,
  HoldingValuation,
  Pitch,
  Trade,
  TradeTicket,
  TreasuryCurvePoint,
} from "@/types/domain";

const BOND_TYPES = new Set(["treasury", "corporate", "agency_mbs", "municipal"]);

const TYPE_LABELS: Record<string, string> = {
  equity: "Equity",
  etf: "ETF",
  treasury: "Treasury",
  corporate: "Corporate",
  agency_mbs: "Agency MBS",
  municipal: "Municipal",
  money_market: "Money Market",
};

const MARK_SOURCE_LABELS: Record<string, string> = {
  bloomberg: "Bloomberg",
  broker: "Broker",
  finra_trace: "TRACE",
  other: "Other",
};

const FINRA_BOND_CENTER = "https://finra-markets.morningstar.com/BondCenter/";

/** Cap on distinct mark dates we resolve curves for (2 queries each). */
const SPREAD_DATE_CAP = 40;

/** Latest treasury_curve rows on or before dateStr, or null. */
async function curveOnOrBefore(
  supabase: SupabaseClient,
  dateStr: string
): Promise<TreasuryCurvePoint[] | null> {
  const { data: dateRow } = await supabase
    .from("treasury_curve")
    .select("curve_date")
    .lte("curve_date", dateStr)
    .order("curve_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curveDate = (dateRow as { curve_date: string } | null)?.curve_date;
  if (!curveDate) return null;

  const { data } = await supabase
    .from("treasury_curve")
    .select("curve_date, tenor_months, yield_pct")
    .eq("curve_date", curveDate);
  const rows = (data as TreasuryCurvePoint[] | null) ?? [];
  return rows.length > 0 ? rows : null;
}

/**
 * Spread (in basis points) of each mark's YTM over the interpolated Treasury
 * par yield at the holding's benchmark tenor, on the nearest curve date at or
 * before the mark. Null per mark when anything needed is missing.
 */
async function spreadsByMarkId(
  supabase: SupabaseClient,
  h: Holding,
  marks: BondMark[]
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  for (const m of marks) out.set(m.id, null);

  const tenorYears = h.benchmark_tenor !== null ? Number(h.benchmark_tenor) : null;
  if (tenorYears === null || !Number.isFinite(tenorYears)) return out;

  const dates = [
    ...new Set(marks.map((m) => easternDateString(new Date(m.marked_at)))),
  ]
    .sort()
    .reverse()
    .slice(0, SPREAD_DATE_CAP);
  const curveByDate = new Map<string, TreasuryCurvePoint[] | null>();
  await Promise.all(
    dates.map(async (d) => {
      curveByDate.set(d, await curveOnOrBefore(supabase, d));
    })
  );

  for (const m of marks) {
    const ytm = m.ytm !== null ? Number(m.ytm) : null;
    if (ytm === null) continue;
    const curve =
      curveByDate.get(easternDateString(new Date(m.marked_at))) ?? null;
    if (!curve || curve.length === 0) continue;
    const treasuryYield = interpolateYield(curve, tenorYears);
    if (treasuryYield === null) continue;
    out.set(m.id, (ytm - treasuryYield) * 100);
  }
  return out;
}

function gainClass(value: number | null): string {
  return (value ?? 0) >= 0 ? "text-gain" : "text-loss";
}

const thClass =
  "px-3 py-2.5 text-xs font-medium text-muted sm:px-4";
const tdClass = "px-3 py-2.5 text-xs sm:px-4 sm:py-3 sm:text-sm";

const inlineLink = "font-medium text-accent-text hover:underline";

/** The title a holding goes by everywhere: a bond's name, else its ticker. */
function holdingLabel(h: Pick<Holding, "instrument_type" | "symbol" | "name">) {
  return BOND_TYPES.has(h.instrument_type) ? h.name : h.symbol ?? h.name;
}

/**
 * PostgREST `or` filter matching this security on a ticket or pitch row: the
 * holding itself, or (for rows written before the holding existed) its
 * symbol or CUSIP.
 */
function securityMatch(h: Holding, extra: string[] = []): string {
  return [
    `holding_id.eq.${h.id}`,
    h.symbol ? `symbol.eq."${h.symbol}"` : null,
    h.cusip ? `cusip.eq."${h.cusip}"` : null,
    ...extra,
  ]
    .filter(Boolean)
    .join(",");
}

// ── Shared sections ─────────────────────────────────────────────────────────

function TradesCard({
  trades,
  isBond,
  fund,
  pitchByTicket,
  tradesHref,
}: {
  trades: Trade[];
  isBond: boolean;
  fund: FundSlug;
  pitchByTicket: Record<string, TradePitch>;
  tradesHref: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Position history"
        action={
          trades.length > 0 ? (
            <Link href={tradesHref} className={`text-sm ${inlineLink}`}>
              View trades
            </Link>
          ) : undefined
        }
      />
      <HoldingTradesTable
        trades={trades}
        isBond={isBond}
        fund={fund}
        pitchByTicket={pitchByTicket}
      />
    </Card>
  );
}

function PitchesCard({
  pitches,
  fund,
  empty,
}: {
  pitches: Pitch[];
  fund: FundSlug;
  /** What to say, and offer, when no pitch names this holding. */
  empty: ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Pitches" />
      {pitches.length === 0 ? (
        <p className="p-6 text-sm text-muted">{empty}</p>
      ) : (
        <div className="divide-y divide-card-border/50">
          {pitches.map((p) => (
            <Link
              key={p.id}
              href={`/${fund}/pitches/${p.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-highlight sm:px-6"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{p.title}</p>
                <p className="text-xs capitalize text-muted">
                  {p.action} · {formatDate(p.created_at)}
                </p>
              </div>
              <PitchStatusBadge status={p.status} />
            </Link>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Metadata ────────────────────────────────────────────────────────────────

/** The tab reads "ANET · Athena · SMIF Hub", the same name as the H1. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}): Promise<Metadata> {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx || !ctx.canViewCurrent) return { title: "Holdings" };
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("holdings")
    .select("instrument_type, symbol, name")
    .eq("fund_id", ctx.fund.id)
    .eq("id", id)
    .maybeSingle();
  const h = data as Pick<Holding, "instrument_type" | "symbol" | "name"> | null;
  return { title: h ? holdingLabel(h) : "Holdings" };
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function HoldingDetailPage({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  const fund = ctx.fund.slug;
  const back = { href: `/${fund}/holdings`, label: "Holdings" };

  if (!ctx.canViewCurrent) {
    return (
      <div className="space-y-6">
        <PageHeader title="Holdings" back={back} />
        <AlumniNotice fundName={ctx.fund.name} />
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const valuation = await valueFund(supabase, ctx.fund.id);
  const v: HoldingValuation | undefined = valuation.holdings.find(
    (x) => x.holding.id === id
  );
  if (!v) notFound();

  const h = v.holding;
  const isBond = BOND_TYPES.has(h.instrument_type);
  const isChartable = !isBond && h.symbol !== null;
  const quantity = Number(h.quantity);
  const avgCost = Number(h.avg_cost);
  const unrealizedPct =
    v.costBasis > 0 ? (v.unrealizedGain / v.costBasis) * 100 : null;
  const sector = h.sector_id
    ? valuation.sectors.find((s) => s.sectorId === h.sector_id) ?? null
    : null;

  // Who may do what from here. Manage holdings and executing tickets are the
  // same people today (the PM, the advisor, app admins); asked separately so
  // each link follows its own page's gate.
  const manages = can(ctx, "manage_holdings");
  const executes = can(ctx, "execute_ticket");
  const markable =
    h.pricing_method === "manual" || h.pricing_method === "treasury_curve";
  const adminHref = `/${fund}/admin/holdings?holding=${h.id}#holding-${h.id}`;
  const markHref = `/${fund}/admin/holdings?holding=${h.id}&mode=mark#holding-${h.id}`;
  const sellHref = `/${fund}/admin/tickets?holding=${h.id}&action=sell`;
  const tradesHref = `/${fund}/trades?symbol=${encodeURIComponent(h.symbol ?? h.name)}`;

  const tradesPromise = supabase
    .from("trades")
    .select("*")
    .eq("fund_id", ctx.fund.id)
    .eq("holding_id", h.id)
    .order("trade_date", { ascending: false })
    .then(({ data }) => (data as Trade[] | null) ?? []);

  // Tickets for this security: the pending ones are shown, and the pitch on
  // any of them (executed too) counts as a pitch behind the position.
  const ticketsPromise = supabase
    .from("trade_tickets")
    .select("*")
    .eq("fund_id", ctx.fund.id)
    .in("status", ["pending", "executed"])
    .or(securityMatch(h))
    .order("created_at", { ascending: false })
    .then(({ data }) => (data as TradeTicket[] | null) ?? []);

  const pitchesPromise = ticketsPromise.then(async (tickets) => {
    const fromTickets = [
      ...new Set(
        tickets
          .map((t) => t.pitch_id)
          .filter((pid): pid is string => pid !== null)
      ),
    ];
    const { data } = await supabase
      .from("pitches")
      .select("*")
      .eq("fund_id", ctx.fund.id)
      .or(
        securityMatch(
          { ...h, cusip: null },
          fromTickets.length > 0 ? [`id.in.(${fromTickets.join(",")})`] : []
        )
      )
      .order("created_at", { ascending: false });
    return (data as Pitch[] | null) ?? [];
  });

  const marksPromise: PromiseLike<BondMark[]> = isBond
    ? supabase
        .from("bond_marks")
        .select("*")
        .eq("holding_id", h.id)
        .order("marked_at", { ascending: false })
        .then(({ data }) => (data as BondMark[] | null) ?? [])
    : Promise.resolve([]);

  const keyStatsPromise: Promise<Record<string, number | string | null>> =
    isChartable && h.symbol ? getKeyStats(h.symbol) : Promise.resolve({});

  const [trades, tickets, pitches, marks, keyStats] = await Promise.all([
    tradesPromise,
    ticketsPromise,
    pitchesPromise,
    marksPromise,
    keyStatsPromise,
  ]);

  const pitchTitle = new Map(pitches.map((p) => [p.id, p.title]));
  const pitchByTicket: Record<string, TradePitch> = {};
  for (const t of tickets) {
    const title = t.pitch_id ? pitchTitle.get(t.pitch_id) : undefined;
    if (t.pitch_id && title) pitchByTicket[t.id] = { id: t.pitch_id, title };
  }
  // A pending ticket for another holding of the same symbol is not this
  // one's; a ticket with no holding yet (a buy from a pitch) is.
  const pending = tickets.filter(
    (t) =>
      t.status === "pending" && (t.holding_id === null || t.holding_id === h.id)
  );
  const sectorById = new Map(valuation.sectors.map((s) => [s.sectorId, s]));

  const spreads =
    isBond && marks.length > 0
      ? await spreadsByMarkId(supabase, h, marks)
      : new Map<string, number | null>();

  const schedule = isBond ? couponSchedule(h, new Date()) : [];
  const nextCoupon = schedule.length > 0 ? schedule[0] : null;

  const markChartData: ChartPoint[] = [...marks]
    .sort(
      (a, b) =>
        new Date(a.marked_at).getTime() - new Date(b.marked_at).getTime()
    )
    .map((m) => ({
      time: easternDateString(new Date(m.marked_at)),
      value: Number(m.clean_price),
    }));
  const marksUp =
    markChartData.length < 2 ||
    markChartData[markChartData.length - 1].value >= markChartData[0].value;

  const staleMarkDays = Number(ctx.fund.settings?.stale_mark_days ?? 7);

  // What a stale price means, and who can do something about it.
  let staleFix: ReactNode = null;
  if (v.stale && markable) {
    staleFix = manages ? (
      <Link href={markHref} className={inlineLink}>
        Enter mark
      </Link>
    ) : (
      "The portfolio manager enters marks."
    );
  }

  const pitchesEmpty: ReactNode = (() => {
    const draftsHere =
      sector !== null && can(ctx, "draft_pitch", { sectorId: sector.sectorId });
    if (draftsHere) {
      return (
        <>
          No pitches name this holding yet.{" "}
          <Link
            href={`/${fund}/pitches/new?sector=${sector.sectorSlug}`}
            className={inlineLink}
          >
            New pitch
          </Link>
        </>
      );
    }
    if (sector) {
      return (
        <>
          No pitches name this holding yet. Its sector&apos;s members pitch it
          from the{" "}
          <SectorLink
            fund={fund}
            slug={sector.sectorSlug}
            name={sector.sectorName}
            className={inlineLink}
          />{" "}
          page.
        </>
      );
    }
    return "No pitches name this holding yet.";
  })();

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        back={back}
        title={
          <span className="flex items-center gap-3">
            {!isBond && h.symbol && (
              <SecurityLogo symbol={h.symbol} name={h.name} size="lg" />
            )}
            <span className="min-w-0">{holdingLabel(h)}</span>
          </span>
        }
        description={
          !isBond && h.symbol ? h.name : isBond && h.issuer ? h.issuer : undefined
        }
        actions={
          manages || executes ? (
            <>
              {manages && markable && (
                <LinkButton
                  href={markHref}
                  variant={v.stale ? "primary" : "secondary"}
                >
                  <PencilLine className="h-4 w-4" aria-hidden="true" />
                  Enter mark
                </LinkButton>
              )}
              {executes && (
                <LinkButton href={sellHref} variant="secondary">
                  <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
                  Sell or close
                </LinkButton>
              )}
              {manages && (
                <ManageLink href={adminHref}>Manage holdings</ManageLink>
              )}
            </>
          ) : undefined
        }
      />

      {/* Price, where it came from, and what the security is */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-2xl font-semibold tabular-nums">
            {isBond ? formatBondPrice(v.price) : formatCurrency(v.price)}
          </span>
          {!isBond && v.dayChange !== null && (
            <span
              className={`text-sm font-medium tabular-nums ${gainClass(v.dayChange)}`}
            >
              {formatSignedCurrency(v.dayChange)} (
              {formatSignedPercent(v.dayChangePct)})
            </span>
          )}
          <PriceSourceBadge
            source={v.priceSource}
            markedAt={v.markedAt}
            stale={v.stale}
            price={v.price}
          />
          <span className="hidden h-4 w-px bg-card-border sm:block" aria-hidden="true" />
          <Badge tone="accent">
            {TYPE_LABELS[h.instrument_type] ?? h.instrument_type}
          </Badge>
          {sector && (
            <Badge>
              <SectorLink
                fund={fund}
                slug={sector.sectorSlug}
                name={sector.sectorName}
              />
            </Badge>
          )}
          {h.rating && <Badge tone="info">{h.rating}</Badge>}
          {h.cusip && (
            <span className="text-xs text-muted">CUSIP {h.cusip}</span>
          )}
        </div>
        {v.stale && (
          <p className="text-sm text-muted">
            <span className="font-medium text-foreground">Stale price.</span>{" "}
            {stalePriceReason({
              source: v.priceSource,
              markedAt: v.markedAt,
              price: v.price,
              staleMarkDays,
            })}
            {staleFix && <> {staleFix}</>}
          </p>
        )}
      </div>

      {/* Position stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label="Market value"
          value={formatCurrency(v.marketValue)}
          sub={`${formatPercent(v.weightPct)} of fund`}
          subClassName="text-muted"
        />
        <StatCard
          label="Unrealized gain"
          value={
            <span className={gainClass(v.unrealizedGain)}>
              {formatSignedCurrency(v.unrealizedGain)}
            </span>
          }
          sub={formatSignedPercent(unrealizedPct)}
          subClassName={gainClass(v.unrealizedGain)}
        />
        {isBond ? (
          <>
            <StatCard
              label="Face value"
              value={formatCurrencyWhole(quantity)}
              sub={
                h.coupon_rate !== null
                  ? `${formatPercent(Number(h.coupon_rate), 3)} coupon · due ${formatDate(h.maturity_date)}`
                  : `due ${formatDate(h.maturity_date)}`
              }
              subClassName="text-muted"
            />
            <StatCard
              label="YTM"
              value={formatPercent(v.ytm, 2)}
              sub={
                v.duration !== null
                  ? `${formatNumber(v.duration, 1)}y duration`
                  : "duration —"
              }
              subClassName="text-muted"
            />
          </>
        ) : (
          <>
            <StatCard
              label={h.instrument_type === "money_market" ? "Units" : "Shares"}
              value={formatNumber(quantity)}
              sub={`${formatCurrency(avgCost)} avg cost`}
              subClassName="text-muted"
            />
            <StatCard
              label="Cost basis"
              value={formatCurrency(v.costBasis)}
              sub={h.opened_on ? `opened ${formatDate(h.opened_on)}` : undefined}
              subClassName="text-muted"
            />
          </>
        )}
      </div>

      {/* Pending tickets: what is about to happen to this position */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold sm:text-lg">
            Pending tickets
            <span className="ml-2 text-sm font-normal text-muted tabular-nums">
              {pending.length}
            </span>
          </h2>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            {pending.map((t) => (
              <TicketCard
                key={t.id}
                id={`ticket-${t.id}`}
                ticket={t}
                fund={fund}
                sectorName={
                  t.sector_id ? sectorById.get(t.sector_id)?.sectorName ?? null : null
                }
                sectorSlug={
                  t.sector_id ? sectorById.get(t.sector_id)?.sectorSlug ?? null : null
                }
                pitchTitle={t.pitch_id ? pitchTitle.get(t.pitch_id) ?? null : null}
                footer={
                  executes ? (
                    <Link
                      href={`/${fund}/admin/tickets#ticket-${t.id}`}
                      className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text hover:underline"
                    >
                      Record execution
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <p className="text-muted">
                        Waiting to be executed by the portfolio manager.
                      </p>
                      <Link
                        href={`/${fund}/trades#ticket-${t.id}`}
                        className={inlineLink}
                      >
                        View trades
                      </Link>
                    </div>
                  )
                }
              />
            ))}
          </div>
        </section>
      )}

      {/* Equity/ETF: price chart + key stats */}
      {isChartable && h.symbol && (
        <>
          <Card className="p-4 sm:p-6">
            <StockChart symbol={h.symbol} fund={fund} />
          </Card>
          <KeyStatsCard stats={keyStats} symbol={h.symbol} />
        </>
      )}

      {/* Bond: mark history, cash flows, TRACE */}
      {isBond && (
        <>
          <Card className="overflow-hidden">
            <CardHeader
              title="Mark history"
              action={
                manages && markable && marks.length > 0 ? (
                  <Link href={markHref} className={`text-sm ${inlineLink}`}>
                    Enter mark
                  </Link>
                ) : undefined
              }
            />
            {marks.length === 0 ? (
              <p className="p-6 text-sm text-muted">
                {h.pricing_method === "manual" ? (
                  manages ? (
                    <>
                      No marks yet.{" "}
                      <Link href={markHref} className={inlineLink}>
                        Enter mark
                      </Link>
                    </>
                  ) : (
                    "No marks yet. The portfolio manager enters them."
                  )
                ) : h.pricing_method === "treasury_curve" ? (
                  manages ? (
                    <>
                      No manual marks: this bond is priced off the Treasury
                      curve.{" "}
                      <Link href={markHref} className={inlineLink}>
                        Enter mark
                      </Link>{" "}
                      to override it.
                    </>
                  ) : (
                    "No manual marks: this bond is priced off the Treasury curve."
                  )
                ) : (
                  "No manual marks: this bond is priced from a live quote."
                )}
              </p>
            ) : (
              <>
                {markChartData.length >= 2 && (
                  <div className="px-2 pt-4 sm:px-4">
                    <ValueChart
                      data={markChartData}
                      isPositive={marksUp}
                      fund={fund}
                      height={190}
                    />
                  </div>
                )}
                <MarkHistoryTable
                  marks={marks.map((m) => ({
                    ...m,
                    spreadBp: spreads.get(m.id) ?? null,
                    sourceLabel: MARK_SOURCE_LABELS[m.source] ?? m.source,
                  }))}
                />
              </>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Cash flow schedule"
              action={
                nextCoupon ? (
                  <span className="text-xs text-muted">
                    next: {formatDate(nextCoupon.date)}
                  </span>
                ) : undefined
              }
            />
            {schedule.length === 0 ? (
              <p className="p-6 text-sm text-muted">
                No remaining cash flows to show.{" "}
                {manages ? (
                  <>
                    Check the bond&apos;s coupon, payment frequency and maturity
                    in{" "}
                    <Link href={adminHref} className={inlineLink}>
                      Manage holdings
                    </Link>
                    .
                  </>
                ) : (
                  "The bond's coupon or maturity details may be missing."
                )}
              </p>
            ) : (
              <div className="max-h-72 overflow-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-card-border text-left">
                      <th
                        className={`${thClass} sticky left-0 top-0 z-20 bg-sticky-card`}
                      >
                        Date
                      </th>
                      <th className={`${thClass} sticky top-0 bg-sticky-card text-right`}>
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule.map((flow, i) => (
                      <tr
                        key={flow.date.toISOString()}
                        className="border-b border-card-border/50"
                      >
                        <td
                          className={`${tdClass} sticky left-0 z-10 bg-sticky-card`}
                        >
                          {formatDate(flow.date)}
                          {i === schedule.length - 1 && (
                            <span className="ml-2 text-[11px] text-muted">
                              incl. principal
                            </span>
                          )}
                        </td>
                        <td className={`${tdClass} text-right font-medium`}>
                          {formatCurrency(flow.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-sm font-medium">FINRA TRACE</p>
              <p className="mt-0.5 text-xs text-muted">
                {h.cusip ? (
                  `Search CUSIP ${h.cusip} on FINRA's Bond Center to eyeball recent TRACE prints.`
                ) : manages ? (
                  <>
                    No CUSIP on file. Add one in{" "}
                    <Link href={adminHref} className={inlineLink}>
                      Manage holdings
                    </Link>{" "}
                    to look up TRACE prints.
                  </>
                ) : (
                  "No CUSIP on file, so TRACE prints can't be looked up."
                )}
              </p>
            </div>
            {h.cusip && (
              <a
                href={FINRA_BOND_CENTER}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-highlight"
              >
                Look up TRACE prints
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            )}
          </Card>
        </>
      )}

      <TradesCard
        trades={trades}
        isBond={isBond}
        fund={fund}
        pitchByTicket={pitchByTicket}
        tradesHref={tradesHref}
      />
      <PitchesCard pitches={pitches} fund={fund} empty={pitchesEmpty} />
    </div>
  );
}
