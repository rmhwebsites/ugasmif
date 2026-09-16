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
// The holding is located inside valueFund's output — an id that is not an
// active holding of THIS fund is a notFound().

import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFundContext } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { valueFund } from "@/lib/valuation";
import { getKeyStats } from "@/lib/yahoo";
import { couponSchedule } from "@/lib/bonds/accrued";
import { interpolateYield } from "@/lib/bonds/treasury";
import { StockChart } from "@/components/holdings/StockChart";
import { PriceSourceBadge } from "@/components/holdings/PriceSourceBadge";
import { ValueChart } from "@/components/charts/ValueChart";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { Badge, PitchStatusBadge } from "@/components/ui/Badge";
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
  Holding,
  HoldingValuation,
  Pitch,
  Trade,
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

function spreadLabel(bp: number | null): string {
  if (bp === null || !Number.isFinite(bp)) return "—";
  const rounded = Math.round(bp);
  return `${rounded >= 0 ? "+" : ""}${rounded} bp`;
}

function gainClass(value: number | null): string {
  return (value ?? 0) >= 0 ? "text-gain" : "text-loss";
}

const thClass =
  "px-3 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted sm:px-4 sm:text-xs";
const tdClass = "px-3 py-2.5 text-xs sm:px-4 sm:py-3 sm:text-sm";

// ── Shared sections ─────────────────────────────────────────────────────────

function TradesCard({ trades, isBond }: { trades: Trade[]; isBond: boolean }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Position History" />
      {trades.length === 0 ? (
        <p className="p-6 text-sm text-muted">
          No trades recorded for this holding yet. Executed tickets will show
          up here.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 560 }}>
            <thead>
              <tr className="border-b border-card-border text-left">
                <th className={thClass}>Date</th>
                <th className={thClass}>Action</th>
                <th className={`${thClass} text-right`}>
                  {isBond ? "Face" : "Shares"}
                </th>
                <th className={`${thClass} text-right`}>Price</th>
                <th className={`${thClass} text-right`}>Amount</th>
                <th className={`${thClass} hidden text-right sm:table-cell`}>
                  Commission
                </th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr
                  key={t.id}
                  className="border-b border-card-border/50 transition-colors hover:bg-highlight"
                >
                  <td className={tdClass}>{formatDate(t.trade_date)}</td>
                  <td className={tdClass}>
                    <Badge tone={t.action === "buy" ? "gain" : "loss"}>
                      {t.action}
                    </Badge>
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {isBond
                      ? formatCurrencyWhole(Number(t.quantity))
                      : formatNumber(Number(t.quantity))}
                  </td>
                  <td className={`${tdClass} text-right`}>
                    {isBond
                      ? formatBondPrice(Number(t.price))
                      : formatCurrency(Number(t.price))}
                  </td>
                  <td className={`${tdClass} text-right font-medium`}>
                    {formatCurrency(Number(t.amount))}
                  </td>
                  <td className={`${tdClass} hidden text-right text-muted sm:table-cell`}>
                    {formatCurrency(Number(t.commission))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PitchesCard({ pitches, slug }: { pitches: Pitch[]; slug: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Pitches" />
      {pitches.length === 0 ? (
        <p className="p-6 text-sm text-muted">
          No pitches reference this holding yet. Sector members can start one
          from their sector page.
        </p>
      ) : (
        <div className="divide-y divide-card-border/50">
          {pitches.map((p) => (
            <Link
              key={p.id}
              href={`/${slug}/pitches/${p.id}`}
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

// ── Page ────────────────────────────────────────────────────────────────────

export default async function HoldingDetailPage({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

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

  const tradesPromise = supabase
    .from("trades")
    .select("*")
    .eq("fund_id", ctx.fund.id)
    .eq("holding_id", h.id)
    .order("trade_date", { ascending: false })
    .then(({ data }) => (data as Trade[] | null) ?? []);

  let pitchQuery = supabase
    .from("pitches")
    .select("*")
    .eq("fund_id", ctx.fund.id)
    .order("created_at", { ascending: false });
  pitchQuery = h.symbol
    ? pitchQuery.or(`holding_id.eq.${h.id},symbol.eq."${h.symbol}"`)
    : pitchQuery.eq("holding_id", h.id);
  const pitchesPromise = pitchQuery.then(
    ({ data }) => (data as Pitch[] | null) ?? []
  );

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

  const [trades, pitches, marks, keyStats] = await Promise.all([
    tradesPromise,
    pitchesPromise,
    marksPromise,
    keyStatsPromise,
  ]);

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

  const statNum = (key: string): number | null => {
    const value = keyStats[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const compact = (value: number | null): string =>
    value === null
      ? "—"
      : new Intl.NumberFormat("en-US", {
          notation: "compact",
          maximumFractionDigits: 1,
        }).format(value);
  const marketCap = statNum("marketCap");
  const avgVolume = statNum("averageVolume");
  const keyStatItems: { label: string; value: string }[] = [
    { label: "Market Cap", value: marketCap === null ? "—" : `$${compact(marketCap)}` },
    { label: "P/E (TTM)", value: formatNumber(statNum("trailingPE"), 1) },
    { label: "Forward P/E", value: formatNumber(statNum("forwardPE"), 1) },
    { label: "Dividend Yield", value: formatPercent(statNum("dividendYield"), 2) },
    { label: "Beta", value: formatNumber(statNum("beta"), 2) },
    { label: "52W High", value: formatCurrency(statNum("fiftyTwoWeekHigh")) },
    { label: "52W Low", value: formatCurrency(statNum("fiftyTwoWeekLow")) },
    { label: "Avg Volume", value: compact(avgVolume) },
  ];
  const hasKeyStats = keyStatItems.some((item) => item.value !== "—");

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/${slug}/holdings`}
          className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Holdings
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold sm:text-3xl">
              {isBond ? h.name : h.symbol ?? h.name}
            </h1>
            {!isBond && h.symbol && (
              <p className="mt-0.5 text-sm text-muted">{h.name}</p>
            )}
            {isBond && h.issuer && (
              <p className="mt-0.5 text-sm text-muted">{h.issuer}</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="accent">
                {TYPE_LABELS[h.instrument_type] ?? h.instrument_type}
              </Badge>
              {v.sectorName && <Badge>{v.sectorName}</Badge>}
              {h.rating && <Badge tone="info">{h.rating}</Badge>}
              {h.cusip && (
                <span className="text-xs text-muted">CUSIP {h.cusip}</span>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums">
              {isBond ? formatBondPrice(v.price) : formatCurrency(v.price)}
            </p>
            <div className="mt-1 flex items-center justify-end gap-2">
              {!isBond && v.dayChange !== null && (
                <span
                  className={`text-sm font-medium tabular-nums ${gainClass(v.dayChange)}`}
                >
                  {formatSignedCurrency(v.dayChange)} (
                  {formatSignedPercent(v.dayChangePct)})
                </span>
              )}
              {(isBond || v.stale || v.priceSource !== "live") && (
                <PriceSourceBadge
                  source={v.priceSource}
                  markedAt={v.markedAt}
                  stale={v.stale}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Position stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label="Market Value"
          value={formatCurrency(v.marketValue)}
          sub={`${formatPercent(v.weightPct)} of fund`}
          subClassName="text-muted"
        />
        <StatCard
          label="Unrealized Gain"
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
              label="Face Value"
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
              label="Cost Basis"
              value={formatCurrency(v.costBasis)}
              sub={h.opened_on ? `opened ${formatDate(h.opened_on)}` : undefined}
              subClassName="text-muted"
            />
          </>
        )}
      </div>

      {/* Equity/ETF: price chart + key stats */}
      {isChartable && h.symbol && (
        <>
          <Card className="p-4 sm:p-6">
            <StockChart symbol={h.symbol} fund={ctx.fund.slug} />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Key Stats" />
            {hasKeyStats ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-4 sm:p-6">
                {keyStatItems.map((item) => (
                  <div key={item.label}>
                    <p className="text-[11px] uppercase tracking-wider text-muted">
                      {item.label}
                    </p>
                    <p className="mt-0.5 text-sm font-medium tabular-nums sm:text-base">
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-6 text-sm text-muted">
                Key stats are unavailable right now — Yahoo Finance did not
                return data for {h.symbol}. Refresh in a minute.
              </p>
            )}
          </Card>
        </>
      )}

      {/* Bond: mark history, cash flows, TRACE */}
      {isBond && (
        <>
          <Card className="overflow-hidden">
            <CardHeader title="Mark History" />
            {marks.length === 0 ? (
              <p className="p-6 text-sm text-muted">
                {h.pricing_method === "manual"
                  ? "No marks yet. The PM enters one under Admin → Holdings (“Enter mark”) or uploads a marks CSV."
                  : "No manual marks — this bond is priced automatically. The PM can still enter a mark under Admin → Holdings to override."}
              </p>
            ) : (
              <>
                {markChartData.length >= 2 && (
                  <div className="px-2 pt-4 sm:px-4">
                    <ValueChart
                      data={markChartData}
                      isPositive={marksUp}
                      fund={ctx.fund.slug}
                      height={190}
                    />
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ minWidth: 640 }}>
                    <thead>
                      <tr className="border-b border-card-border text-left">
                        <th className={thClass}>Marked</th>
                        <th className={`${thClass} text-right`}>Clean Price</th>
                        <th className={`${thClass} text-right`}>YTM</th>
                        <th className={`${thClass} text-right`}>Dur</th>
                        <th
                          className={`${thClass} text-right`}
                          title="Mark YTM minus the interpolated Treasury par yield at the holding's benchmark tenor, on the nearest prior curve date."
                        >
                          Sprd vs Tsy
                        </th>
                        <th className={thClass}>Source</th>
                        <th className={`${thClass} hidden md:table-cell`}>
                          Notes
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {marks.map((m) => (
                        <tr
                          key={m.id}
                          className="border-b border-card-border/50 transition-colors hover:bg-highlight"
                        >
                          <td className={tdClass}>{formatDate(m.marked_at)}</td>
                          <td className={`${tdClass} text-right font-medium`}>
                            {formatBondPrice(Number(m.clean_price))}
                          </td>
                          <td className={`${tdClass} text-right`}>
                            {formatPercent(
                              m.ytm !== null ? Number(m.ytm) : null,
                              2
                            )}
                          </td>
                          <td className={`${tdClass} text-right text-muted`}>
                            {m.duration !== null
                              ? formatNumber(Number(m.duration), 1)
                              : "—"}
                          </td>
                          <td className={`${tdClass} text-right text-muted`}>
                            {spreadLabel(spreads.get(m.id) ?? null)}
                          </td>
                          <td className={`${tdClass} text-muted`}>
                            {MARK_SOURCE_LABELS[m.source] ?? m.source}
                          </td>
                          <td
                            className={`${tdClass} hidden max-w-[200px] truncate text-muted md:table-cell`}
                          >
                            {m.notes ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader
              title="Cash Flow Schedule"
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
                No remaining cash flows to show — check the bond&apos;s coupon,
                payment frequency, and maturity fields under Admin → Holdings.
              </p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-card-border text-left">
                      <th className={`${thClass} sticky top-0 bg-sticky backdrop-blur-xl`}>
                        Date
                      </th>
                      <th className={`${thClass} sticky top-0 bg-sticky text-right backdrop-blur-xl`}>
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
                        <td className={tdClass}>
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
                {h.cusip
                  ? `Search CUSIP ${h.cusip} on FINRA's Bond Center to eyeball recent TRACE prints.`
                  : "No CUSIP on file — the PM can add one under Admin → Holdings to enable TRACE lookups."}
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

      <TradesCard trades={trades} isBond={isBond} />
      <PitchesCard pitches={pitches} slug={slug} />
    </div>
  );
}
