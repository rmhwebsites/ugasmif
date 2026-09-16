// Performance page (SPEC 11.2 / 14): newsletter-style period-return table
// (MTD QTD YTD LTM 3Y SI, fund vs benchmark vs difference), cumulative
// growth-of-$1 and drawdown charts, monthly return grid, risk metrics, and
// sector weights vs benchmark. Arch adds the Treasury curve (latest date vs
// ~one month prior) and weighted-duration history from snapshot detail.

import { notFound } from "next/navigation";
import { getAuthState, getFundContext } from "@/lib/fund";
import { valueFund } from "@/lib/valuation";
import {
  benchmarkReturnSeries,
  dailyReturnSeries,
  drawdownSeries,
  monthlyReturnTable,
  riskMetrics,
  timeWeightedReturns,
} from "@/lib/performance";
import { PerformanceView } from "@/components/dashboard/PerformanceView";
import { CurveChart } from "@/components/charts/CurveChart";
import { ValueChart } from "@/components/charts/ValueChart";
import { Card, CardHeader, StatCard } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
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

function SectorWeightsTable({ v }: { v: FundValuation }) {
  const rows = v.sectors.filter(
    (s) =>
      s.weightPct > 0 || s.targetWeightPct !== null || s.benchmarkWeightPct !== null
  );
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Sector weights vs benchmark"
        action={<span className="text-xs text-muted">Live valuation</span>}
      />
      {rows.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted">
          No sector data yet. Officers add sectors and set benchmark weights
          under Fund Admin → Sectors.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="sticky left-0 z-10 bg-sticky px-4 py-2.5 font-medium backdrop-blur-xl sm:px-6">
                  Sector
                </th>
                <th className="px-3 py-2.5 text-right font-medium">Weight</th>
                <th className="px-3 py-2.5 text-right font-medium">Target</th>
                <th className="px-3 py-2.5 text-right font-medium">Benchmark</th>
                <th className="px-3 py-2.5 pr-4 text-right font-medium sm:pr-6">
                  Active
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const active =
                  s.benchmarkWeightPct !== null
                    ? s.weightPct - s.benchmarkWeightPct
                    : null;
                return (
                  <tr
                    key={s.sectorId}
                    className="border-b border-card-border/50 last:border-0"
                  >
                    <td className="sticky left-0 z-10 bg-sticky px-4 py-2.5 font-medium backdrop-blur-xl sm:px-6">
                      {s.sectorName}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatPercent(s.weightPct)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                      {s.targetWeightPct !== null
                        ? formatPercent(s.targetWeightPct)
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted">
                      {s.benchmarkWeightPct !== null
                        ? formatPercent(s.benchmarkWeightPct)
                        : "—"}
                    </td>
                    <td
                      className={`px-3 py-2.5 pr-4 text-right font-medium tabular-nums sm:pr-6 ${cellClass(
                        active
                      )}`}
                    >
                      {pct(active)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default async function PerformancePage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

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
    <div>
      <h1 className="text-xl font-bold sm:text-2xl">Performance</h1>
      <p className="text-xs text-muted sm:text-sm">
        Time-weighted returns, net of external flows · Benchmark:{" "}
        {fund.benchmark_name}
      </p>
    </div>
  );

  if (snapshots.length < 2) {
    return (
      <div className="space-y-4">
        {header}
        <EmptyState
          title="Not enough history yet"
          hint="Performance charts appear after the first two nightly snapshots."
        />
        <SectorWeightsTable v={v} />
      </div>
    );
  }

  const returns = timeWeightedReturns(snapshots, flows);
  const growth = dailyReturnSeries(snapshots, flows);
  const benchGrowth = benchmarkReturnSeries(snapshots);
  const drawdown = drawdownSeries(growth);
  const monthly = monthlyReturnTable(snapshots, flows);
  const rm = riskMetrics(snapshots, flows);
  const top5Weight = [...v.holdings]
    .sort((a, b) => b.weightPct - a.weightPct)
    .slice(0, 5)
    .reduce((s, h) => s + h.weightPct, 0);

  // Arch: latest Treasury curve vs the closest curve ~30 days earlier.
  let curveSeries: {
    label: string;
    points: { tenorYears: number; yieldPct: number }[];
  }[] = [];
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
      const { data: priorRows } = await supabase
        .from("treasury_curve")
        .select("curve_date")
        .lte("curve_date", daysBefore(latestDate, 30))
        .order("curve_date", { ascending: false })
        .limit(1);
      const priorDate =
        ((priorRows as { curve_date: string }[] | null) ?? [])[0]?.curve_date ??
        null;

      const dates = priorDate ? [latestDate, priorDate] : [latestDate];
      const { data: curveRows } = await supabase
        .from("treasury_curve")
        .select("curve_date, tenor_months, yield_pct")
        .in("curve_date", dates);
      const rows = (curveRows as TreasuryCurvePoint[] | null) ?? [];

      const toPoints = (date: string) =>
        rows
          .filter((r) => r.curve_date === date)
          .map((r) => ({
            tenorYears: Number(r.tenor_months) / 12,
            yieldPct: Number(r.yield_pct),
          }))
          .filter(
            (p) => Number.isFinite(p.tenorYears) && Number.isFinite(p.yieldPct)
          )
          .sort((a, b) => a.tenorYears - b.tenorYears);

      curveSeries = [
        { label: `Latest (${formatDate(latestDate)})`, points: toPoints(latestDate) },
        ...(priorDate
          ? [
              {
                label: `1M ago (${formatDate(priorDate)})`,
                points: toPoints(priorDate),
              },
            ]
          : []),
      ].filter((s) => s.points.length > 0);
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
              <tr className="border-b border-card-border text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="sticky left-0 z-10 bg-sticky px-4 py-2.5 font-medium backdrop-blur-xl sm:px-6">
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
                  <td className="sticky left-0 z-10 bg-sticky px-4 py-2.5 backdrop-blur-xl sm:px-6">
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
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-card-border text-[11px] uppercase tracking-wider text-muted">
                <th className="sticky left-0 z-10 bg-sticky px-4 py-2 text-left font-medium backdrop-blur-xl sm:px-6">
                  Year
                </th>
                {MONTH_HEADERS.map((m) => (
                  <th key={m} className="px-2 py-2 text-right font-medium">
                    {m}
                  </th>
                ))}
                <th className="px-2 py-2 pr-4 text-right font-medium sm:pr-6">
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
                  <td className="sticky left-0 z-10 bg-sticky px-4 py-2 font-medium backdrop-blur-xl sm:px-6">
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
          sub="Concentration, live"
        />
      </div>

      {isFixedIncome && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="Treasury curve"
              action={
                <span className="text-xs text-muted">Latest vs 1M ago</span>
              }
            />
            <div className="p-4 sm:p-6">
              <CurveChart series={curveSeries} fund={fund.slug} />
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
      )}

      <SectorWeightsTable v={v} />
    </div>
  );
}
