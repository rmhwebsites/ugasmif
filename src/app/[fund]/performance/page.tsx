// Performance page (SPEC 11.2 / 14): newsletter-style period-return table
// (MTD QTD YTD LTM 3Y SI, fund vs benchmark vs difference), cumulative
// growth-of-$1 and drawdown charts, monthly return grid, risk metrics, sector
// attribution for the selected period (?attr=), and sector weights vs
// benchmark. Arch adds the 2y/5y/10y/30y Treasury curve over time, allocation
// by rating bucket, and weighted-duration history from snapshot detail.
//
// The page is long, so it opens with jump links to its sections: Returns,
// Risk, Sectors (attribution and sector P&L side by side in the reading
// order, at #sector-attribution, which the sector page links to), Arch's
// Rates and credit, and Positions.

import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAuthState, getFundContext } from "@/lib/fund";
import { canOpenAdminSection } from "@/lib/permissions";
import { valueFund } from "@/lib/valuation";
import {
  concentrationCurve,
  maturityLadder,
  positionContributions,
  returnDistribution,
  sectorGains,
  type SectorGain,
} from "@/lib/analysis";
import {
  benchmarkReturnSeries,
  dailyReturnSeries,
  drawdownSeries,
  monthlyReturnTable,
  riskMetrics,
  sectorAttribution,
  timeWeightedReturns,
  type SectorAttribution,
} from "@/lib/performance";
import { PerformanceView } from "@/components/dashboard/PerformanceView";
import {
  CurveChart,
  type CurveHistorySeries,
} from "@/components/charts/CurveChart";
import { ValueChart } from "@/components/charts/ValueChart";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { AlumniNotice } from "@/components/ui/AlumniNotice";
import { ContributionBars } from "@/components/analysis/ContributionBars";
import { ConcentrationChart } from "@/components/analysis/ConcentrationChart";
import { ReturnDispersion } from "@/components/analysis/ReturnDispersion";
import { MaturityLadder } from "@/components/analysis/MaturityLadder";
import {
  RatingBucketTable,
  SectorAttributionTable,
  SectorWeightsTable,
  type RatingBucketRow,
  type SectorSlugs,
} from "@/components/tables/PerformanceTables";
import {
  formatDate,
  formatNumber,
  formatPercent,
  formatSignedPercent,
} from "@/lib/format";
import type {
  CashMovement,
  ChartPoint,
  FundSnapshot,
  FundValuation,
  TreasuryCurvePoint,
} from "@/types/domain";
import { PageHeader } from "@/components/ui/PageHeader";

export const metadata: Metadata = { title: "Performance" };

const MONTH_HEADERS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PERIOD_LABELS: Record<string, string> = {
  MTD: "Month to date",
  QTD: "Quarter to date",
  YTD: "Year to date",
  LTM: "Last 12 months",
  "3Y": "3 years (ann.)",
  SI: "Since inception",
};

/** Windows offered for attribution; anything else in ?attr= falls back to YTD. */
const ATTRIBUTION_PERIODS = ["MTD", "QTD", "YTD", "SI"];

/** The page's sections, in page order. The sector page links to #sector-attribution. */
const SECTIONS = {
  returns: { id: "returns", label: "Returns" },
  risk: { id: "risk", label: "Risk" },
  sectors: { id: "sector-attribution", label: "Sectors" },
  bonds: { id: "rates-and-credit", label: "Rates and credit" },
  positions: { id: "positions", label: "Positions" },
};

const UNCLASSIFIED = "Unclassified";

/** 2y / 5y / 10y / 30y over time (SPEC 14), plotted over the past year. */
const CURVE_TENORS = [
  { months: 24, label: "2Y" },
  { months: 60, label: "5Y" },
  { months: 120, label: "10Y" },
  { months: 360, label: "30Y" },
];
const CURVE_HISTORY_DAYS = 365;

const RATING_BUCKETS = ["AAA", "AA", "A", "BBB", "BB and below", "NR"];

/**
 * holdings.rating is free text entered by the PM, in S&P form ("AA+", "BBB")
 * or Moody's ("Aa1", "Baa2"), so bucket on the letter prefix with notches
 * stripped. Order matters: BBB/Baa are tested before the generic B grades.
 * Anything blank or unrecognized is NR.
 */
function ratingBucket(rating: string | null): string {
  const r = (rating ?? "").trim().toUpperCase();
  if (r === "") return "NR";
  if (r.startsWith("AAA")) return "AAA";
  if (r.startsWith("AA")) return "AA";
  if (r.startsWith("A")) return "A";
  if (r.startsWith("BBB") || r.startsWith("BAA")) return "BBB";
  if (r.startsWith("B") || r.startsWith("C") || r.startsWith("D")) {
    return "BB and below";
  }
  return "NR";
}

function pct(value: number | null): string {
  return value !== null ? formatSignedPercent(value) : "—";
}

function cellClass(value: number | null): string {
  if (value === null) return "text-muted";
  if (value > 0) return "text-gain";
  if (value < 0) return "text-loss";
  return "text-muted";
}

function daysBefore(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Weighted duration out of fund_snapshots.detail, if the cron stored it. */
function durationFromDetail(s: FundSnapshot): number | null {
  const detail = s.detail as Record<string, unknown> | null;
  if (!detail || typeof detail !== "object") return null;
  const raw = detail["weightedDuration"];
  const num =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(num) ? num : null;
}

interface PageSection {
  id: string;
  label: string;
}

/** Jump links to the page's sections, under the header. */
function SectionNav({ sections }: { sections: PageSection[] }) {
  return (
    <nav aria-label="On this page" className="-mx-1 flex flex-wrap gap-1">
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm text-muted transition-colors hover:bg-highlight hover:text-foreground sm:min-h-8"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/** A jump-link target. The scroll margin clears the phone's sticky bar. */
function Section({
  section,
  children,
}: {
  section: PageSection;
  children: ReactNode;
}) {
  return (
    <section
      id={section.id}
      aria-label={section.label}
      className="scroll-mt-20 space-y-4 lg:scroll-mt-6"
    >
      {children}
    </section>
  );
}

function SectorWeightsCard({
  fund,
  v,
  gains,
  sectorSlugs,
  manageSectorsHref,
}: {
  fund: string;
  v: FundValuation;
  gains: SectorGain[];
  sectorSlugs: SectorSlugs;
  manageSectorsHref: string | null;
}) {
  const rows = v.sectors.filter(
    (s) =>
      s.weightPct > 0 ||
      s.targetWeightPct !== null ||
      s.benchmarkWeightPct !== null
  );
  // With no targets set the weights table is three columns of dashes, so it
  // falls back to what each sector actually did. The heading follows.
  const hasTargets = rows.some(
    (s) => s.targetWeightPct !== null || s.benchmarkWeightPct !== null
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={hasTargets ? "Sector weights vs benchmark" : "Sector P&L"}
        action={<span className="text-xs text-muted">Live valuation</span>}
      />
      <SectorWeightsTable
        fund={fund}
        sectors={rows}
        gains={gains}
        sectorSlugs={sectorSlugs}
        manageSectorsHref={manageSectorsHref}
      />
    </Card>
  );
}

/** Green above zero, red below, nothing at all at zero. */
function cellTone(value: number): string {
  if (value === 0) return "";
  return value > 0 ? "text-gain" : "text-loss";
}

function SectorAttributionCard({
  fundSlug,
  selected,
  attribution,
  sectorSlugs,
}: {
  fundSlug: string;
  selected: string;
  attribution: SectorAttribution | null;
  sectorSlugs: SectorSlugs;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Sector attribution"
        action={
          <div className="flex gap-1">
            {ATTRIBUTION_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/${fundSlug}/performance?attr=${p}#sector-attribution`}
                className={`rounded-lg px-2.5 py-1.5 text-xs transition-colors sm:py-1 ${
                  p === selected
                    ? "bg-accent-soft font-medium text-accent-text"
                    : "text-muted hover:bg-highlight hover:text-foreground"
                }`}
              >
                {p}
              </Link>
            ))}
          </div>
        }
      />
      {attribution === null ? (
        <p className="px-6 py-8 text-center text-sm text-muted">
          No attribution for this period yet. It is built from the holding
          prices in the nightly snapshots, so it fills in once two of them
          bracket the period.
        </p>
      ) : (
        <>
          <p className="px-4 pt-3 text-xs text-muted sm:px-6">
            Contribution = each holding&rsquo;s weight on{" "}
            {formatDate(attribution.startDate)} × its return through{" "}
            {formatDate(attribution.endDate)}. Covers{" "}
            {formatPercent(attribution.coveredWeightPct)} of the portfolio.
            Cash, and positions opened or closed inside the period, are not
            attributed.
          </p>
          <SectorAttributionTable
            fund={fundSlug}
            sectorSlugs={sectorSlugs}
            rows={attribution.rows}
            coveredWeightPct={attribution.coveredWeightPct}
            totalPct={attribution.totalPct}
          />
        </>
      )}
    </Card>
  );
}

/** Arch: market-value weighted allocation by rating bucket (SPEC 14). */
function RatingBucketCard({
  v,
  manageHoldingsHref,
}: {
  v: FundValuation;
  manageHoldingsHref: string | null;
}) {
  const byBucket = new Map<string, { marketValue: number; count: number }>();
  for (const h of v.holdings) {
    const bucket = ratingBucket(h.holding.rating);
    const agg = byBucket.get(bucket) ?? { marketValue: 0, count: 0 };
    agg.marketValue += h.marketValue;
    agg.count += 1;
    byBucket.set(bucket, agg);
  }
  const rows: RatingBucketRow[] = RATING_BUCKETS.flatMap((bucket, order) => {
    const agg = byBucket.get(bucket);
    return agg && agg.marketValue > 0
      ? [
          {
            bucket,
            order,
            marketValue: agg.marketValue,
            count: agg.count,
            weightPct:
              v.totalValue > 0 ? (agg.marketValue / v.totalValue) * 100 : 0,
          },
        ]
      : [];
  });

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Allocation by rating"
        action={<span className="text-xs text-muted">Live valuation</span>}
      />
      <RatingBucketTable rows={rows} manageHoldingsHref={manageHoldingsHref} />
    </Card>
  );
}

export default async function PerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ fund: string }>;
  searchParams: Promise<{ attr?: string }>;
}) {
  const [{ fund: slug }, { attr }] = await Promise.all([params, searchParams]);
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!ctx.canViewCurrent) {
    return (
      <div className="space-y-6">
        <PageHeader title="Performance" />
        <AlumniNotice fundName={ctx.fund.name} />
      </div>
    );
  }

  const { supabase } = await getAuthState();
  const fund = ctx.fund;
  const isFixedIncome = fund.asset_class === "fixed_income";

  const [v, snapshotsRes, flowsRes] = await Promise.all([
    valueFund(supabase, fund.id),
    supabase
      .from("fund_snapshots")
      .select("*")
      .eq("fund_id", fund.id)
      .order("snapshot_date", { ascending: true }),
    supabase
      .from("cash_movements")
      .select("*")
      .eq("fund_id", fund.id)
      .in("kind", ["contribution", "withdrawal"]),
  ]);

  const snapshots = (snapshotsRes.data as FundSnapshot[] | null) ?? [];
  const flows = (flowsRes.data as CashMovement[] | null) ?? [];

  const header = (
    <PageHeader
      title="Performance"
      description={`Time-weighted returns, net of money added or withdrawn, against the ${fund.benchmark_name}.`}
    />
  );

  const byWeight = [...v.holdings].sort((a, b) => b.weightPct - a.weightPct);
  const sumWeight = (n: number) =>
    byWeight.slice(0, n).reduce((sum, h) => sum + h.weightPct, 0);
  const top5Weight = sumWeight(5);
  const top10Weight = sumWeight(10);

  // Empty tables point at the admin page that fills them, for people who
  // may open it. Attribution and sector P&L rows know only the sector's name.
  const manageSectorsHref = canOpenAdminSection(ctx, "sectors")
    ? `/${fund.slug}/admin/sectors`
    : null;
  const manageHoldingsHref = canOpenAdminSection(ctx, "holdings")
    ? `/${fund.slug}/admin/holdings`
    : null;
  const sectorSlugs: SectorSlugs = Object.fromEntries(
    v.sectors.map((s) => [s.sectorName, s.sectorSlug])
  );

  // Analysis that needs no snapshot history. Returns, drawdown and attribution
  // all chain off fund_snapshots and say nothing until the nightly cron has run
  // twice; these are computed from what the fund holds right now, so they are
  // useful on day one and render in both branches below.
  const contributions = positionContributions(v.holdings);
  const concentration = concentrationCurve(v.holdings, 20);
  const dispersion = returnDistribution(v.holdings);
  const gainsBySector = sectorGains(v.holdings);
  const ladder = isFixedIncome ? maturityLadder(v.holdings) : [];
  const sectorWeightsCard = (
    <SectorWeightsCard
      fund={fund.slug}
      v={v}
      gains={gainsBySector}
      sectorSlugs={sectorSlugs}
      manageSectorsHref={manageSectorsHref}
    />
  );
  const ladderCard =
    isFixedIncome && ladder.length > 0 ? (
      <Card className="overflow-hidden">
        <CardHeader
          title="Maturity ladder"
          action={<span className="text-xs text-muted">Face by year</span>}
        />
        <MaturityLadder buckets={ladder} />
      </Card>
    ) : null;
  const positionsSection = (
    <Section section={SECTIONS.positions}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label="Unrealized"
          value={
            <span className={dispersion.weightedPct === null ? "" : cellTone(dispersion.weightedPct)}>
              {dispersion.weightedPct === null
                ? "—"
                : formatSignedPercent(dispersion.weightedPct)}
            </span>
          }
          sub="On cost, whole book"
        />
        <StatCard
          label="Winners"
          value={`${dispersion.winners} / ${
            dispersion.winners + dispersion.losers
          }`}
          sub={
            dispersion.medianPct === null
              ? "No priced positions"
              : `Median ${formatSignedPercent(dispersion.medianPct)}`
          }
        />
        <StatCard
          label="Best"
          value={
            <span className="block truncate" title={dispersion.best?.label}>
              {dispersion.best?.label ?? "—"}
            </span>
          }
          sub={
            dispersion.best
              ? formatSignedPercent(dispersion.best.returnPct)
              : undefined
          }
          subClassName="text-gain"
        />
        <StatCard
          label="Worst"
          value={
            <span className="block truncate" title={dispersion.worst?.label}>
              {dispersion.worst?.label ?? "—"}
            </span>
          }
          sub={
            dispersion.worst
              ? formatSignedPercent(dispersion.worst.returnPct)
              : undefined
          }
          subClassName={
            dispersion.worst && dispersion.worst.returnPct < 0
              ? "text-loss"
              : "text-gain"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card className="overflow-hidden">
          <CardHeader
            title="Contribution to unrealized gain"
            action={
              <span className="text-xs text-muted">Biggest movers first</span>
            }
          />
          <ContributionBars rows={contributions} fund={fund.slug} limit={8} />
        </Card>
        {/* Flex column so the curve grows to match the taller card beside
            it rather than leaving the bottom third of this one empty. */}
        <Card className="flex flex-col">
          <CardHeader
            title="Concentration"
            action={
              <span className="text-xs tabular-nums text-muted">
                Top 5 {formatPercent(top5Weight)} · top 10{" "}
                {formatPercent(top10Weight)}
              </span>
            }
          />
          <div className="flex-1 p-4 sm:p-6">
            <ConcentrationChart
              points={concentration}
              fund={fund.slug}
              className="h-full min-h-52"
            />
          </div>
        </Card>
      </div>
      <Card className="overflow-hidden">
        <CardHeader
          title="Return dispersion"
          action={
            <span className="text-xs text-muted">Every position, on cost</span>
          }
        />
        <ReturnDispersion positions={dispersion.positions} fund={fund.slug} />
      </Card>
    </Section>
  );

  if (snapshots.length < 2) {
    return (
      <div className="space-y-4">
        {header}
        <SectionNav
          sections={[
            SECTIONS.sectors,
            ...(isFixedIncome ? [SECTIONS.bonds] : []),
            SECTIONS.positions,
          ]}
        />
        <p className="rounded-lg bg-highlight px-4 py-2.5 text-sm text-muted">
          <span className="font-medium text-foreground">
            Return history starts after tonight.
          </span>{" "}
          Returns, drawdown and attribution come from the nightly snapshots and
          need two of them. Everything below is live from the current portfolio.
        </p>
        <Section section={SECTIONS.sectors}>{sectorWeightsCard}</Section>
        {isFixedIncome && (
          <Section section={SECTIONS.bonds}>
            <RatingBucketCard v={v} manageHoldingsHref={manageHoldingsHref} />
            {ladderCard}
          </Section>
        )}
        {positionsSection}
      </div>
    );
  }

  const returns = timeWeightedReturns(snapshots, flows);
  const growth = dailyReturnSeries(snapshots, flows);
  const benchGrowth = benchmarkReturnSeries(snapshots);
  const drawdown = drawdownSeries(growth);
  const monthly = monthlyReturnTable(snapshots, flows);
  const rm = riskMetrics(snapshots, flows);
  // Sector attribution for the window in ?attr= (SPEC 11.2). valueFund()
  // already resolved each holding's sector, so the map comes free.
  const attrPeriod = attr && ATTRIBUTION_PERIODS.includes(attr) ? attr : "YTD";
  const sectorByHoldingId = new Map(
    v.holdings.map((h) => [h.holding.id, h.sectorName ?? UNCLASSIFIED])
  );
  const attribution = sectorAttribution(
    snapshots,
    sectorByHoldingId,
    attrPeriod,
    UNCLASSIFIED
  );

  // Arch: 2y / 5y / 10y / 30y par yields over the past year (SPEC 14).
  let curveHistory: CurveHistorySeries[] = [];
  let durationHistory: ChartPoint[] = [];
  if (isFixedIncome) {
    const { data: latestRows } = await supabase
      .from("treasury_curve")
      .select("curve_date")
      .order("curve_date", { ascending: false })
      .limit(1);
    const latestDate =
      ((latestRows as { curve_date: string }[] | null) ?? [])[0]?.curve_date ??
      null;

    if (latestDate) {
      const { data: curveRows } = await supabase
        .from("treasury_curve")
        .select("curve_date, tenor_months, yield_pct")
        .in(
          "tenor_months",
          CURVE_TENORS.map((t) => t.months)
        )
        .gte("curve_date", daysBefore(latestDate, CURVE_HISTORY_DAYS))
        .order("curve_date", { ascending: true });
      const rows = (curveRows as TreasuryCurvePoint[] | null) ?? [];

      curveHistory = CURVE_TENORS.map((t) => ({
        label: t.label,
        points: rows
          .filter((r) => Number(r.tenor_months) === t.months)
          .map((r) => ({
            date: r.curve_date.slice(0, 10),
            yieldPct: Number(r.yield_pct),
          }))
          .filter((pt) => Number.isFinite(pt.yieldPct)),
      })).filter((series) => series.points.length > 0);
    }

    durationHistory = snapshots.flatMap((s) => {
      const value = durationFromDetail(s);
      return value !== null
        ? [{ time: s.snapshot_date.slice(0, 10), value }]
        : [];
    });
  }

  return (
    <div className="space-y-4">
      {header}
      <SectionNav
        sections={[
          SECTIONS.returns,
          SECTIONS.risk,
          SECTIONS.sectors,
          ...(isFixedIncome ? [SECTIONS.bonds] : []),
          SECTIONS.positions,
        ]}
      />

      <Section section={SECTIONS.returns}>
        {/* Deliberately unsorted: MTD → SI is the order that carries the
            meaning, and there are only ever six rows. */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Returns vs benchmark"
            action={
              <span className="text-xs text-muted">
                {snapshots.length} snapshots since{" "}
                {formatDate(snapshots[0].snapshot_date)}
              </span>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-card-border text-left text-xs font-medium text-muted">
                  <th className="sticky left-0 z-10 bg-sticky-card px-4 py-2.5 font-medium sm:px-6">
                    Period
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">Fund</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {fund.benchmark_name}
                  </th>
                  <th className="px-3 py-2.5 pr-4 text-right font-medium sm:pr-6">
                    +/−
                  </th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => (
                  <tr
                    key={r.label}
                    className="border-b border-card-border/50 last:border-0"
                  >
                    <td className="sticky left-0 z-10 bg-sticky-card px-4 py-2.5 sm:px-6">
                      <span className="font-medium">{r.label}</span>
                      <span className="ml-2 hidden text-xs text-muted sm:inline">
                        {PERIOD_LABELS[r.label] ?? ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {pct(r.fund)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                      {pct(r.benchmark)}
                    </td>
                    <td
                      className={`px-3 py-2.5 pr-4 text-right font-medium tabular-nums sm:pr-6 ${cellClass(
                        r.diff
                      )}`}
                    >
                      {pct(r.diff)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <PerformanceView
          fund={fund.slug}
          growth={growth}
          benchmarkGrowth={benchGrowth}
          drawdown={drawdown}
          benchmarkName={fund.benchmark_name}
        />

        <Card className="overflow-hidden">
          <CardHeader title="Monthly returns" />
          {/* Deliberately unsorted: Jan → Dec across, newest year down. A click
              that reordered the months would only lose the meaning. A fund with
              twenty years of history still scrolls, so the months stay pinned. */}
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-card-border text-xs font-medium text-muted">
                  <th className="sticky left-0 top-0 z-30 bg-sticky-card px-4 py-2 text-left font-medium sm:px-6">
                    Year
                  </th>
                  {MONTH_HEADERS.map((m) => (
                    <th
                      key={m}
                      className="sticky top-0 z-20 bg-sticky-card px-2 py-2 text-right font-medium"
                    >
                      {m}
                    </th>
                  ))}
                  <th className="sticky top-0 z-20 bg-sticky-card px-2 py-2 pr-4 text-right font-medium sm:pr-6">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {monthly.map((row) => (
                  <tr
                    key={row.year}
                    className="border-b border-card-border/50 last:border-0"
                  >
                    <td className="sticky left-0 z-10 bg-sticky-card px-4 py-2 font-medium sm:px-6">
                      {row.year}
                    </td>
                    {row.months.map((m, i) => (
                      <td
                        key={MONTH_HEADERS[i]}
                        className={`px-2 py-2 text-right tabular-nums ${cellClass(m)}`}
                      >
                        {m !== null ? formatSignedPercent(m) : "—"}
                      </td>
                    ))}
                    <td
                      className={`px-2 py-2 pr-4 text-right font-semibold tabular-nums sm:pr-6 ${cellClass(
                        row.total
                      )}`}
                    >
                      {pct(row.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section section={SECTIONS.risk}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <StatCard
            label="Volatility (ann.)"
            value={rm ? formatPercent(rm.volatility) : "—"}
            sub={rm ? "From daily snapshots" : "Appears after 20 snapshots"}
          />
          <StatCard
            label="Max drawdown"
            value={
              rm ? (
                <span className="text-loss">
                  −{formatPercent(rm.maxDrawdown)}
                </span>
              ) : (
                "—"
              )
            }
            sub={rm ? "Peak to trough" : "Appears after 20 snapshots"}
          />
          <StatCard
            label="Beta"
            value={rm && rm.beta !== null ? formatNumber(rm.beta, 2) : "—"}
            sub={
              rm
                ? `vs ${fund.benchmark_name}`
                : "Appears after 20 snapshots"
            }
          />
          <StatCard
            label="Top 5 weight"
            value={formatPercent(top5Weight)}
            sub={`Top 10: ${formatPercent(top10Weight)}`}
          />
        </div>
      </Section>

      <Section section={SECTIONS.sectors}>
        <SectorAttributionCard
          fundSlug={fund.slug}
          selected={attrPeriod}
          attribution={attribution}
          sectorSlugs={sectorSlugs}
        />
        {sectorWeightsCard}
      </Section>

      {isFixedIncome && (
        <Section section={SECTIONS.bonds}>
          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <Card>
              <CardHeader
                title="Treasury curve"
                action={
                  <span className="text-xs text-muted">
                    Par yields, past 12 months
                  </span>
                }
              />
              <div className="p-4 sm:p-6">
                <CurveChart history={curveHistory} fund={fund.slug} />
              </div>
            </Card>
            {durationHistory.length >= 2 && (
              <Card className="overflow-hidden">
                <CardHeader
                  title="Duration history"
                  action={
                    <span className="text-xs tabular-nums text-muted">
                      Now{" "}
                      {formatNumber(
                        durationHistory[durationHistory.length - 1].value,
                        1
                      )}{" "}
                      yrs
                    </span>
                  }
                />
                <div className="px-1 py-3">
                  <ValueChart
                    data={durationHistory}
                    isPositive
                    fund={fund.slug}
                    height={220}
                    showPriceScale
                  />
                </div>
              </Card>
            )}
          </div>
          <RatingBucketCard v={v} manageHoldingsHref={manageHoldingsHref} />
          {ladderCard}
        </Section>
      )}

      {positionsSection}
    </div>
  );
}
