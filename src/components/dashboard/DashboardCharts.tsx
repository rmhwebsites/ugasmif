"use client";

// Dashboard value chart card: fetches /api/[fund]/portfolio/history for the
// selected period (1M / 3M / YTD / 1Y / All), overlays the benchmark rebased
// to the fund's starting value, and shows a hover readout via the chart's
// crosshair callback (GBH PortfolioSummary pattern, without SWR).

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import { ValueChart } from "@/components/charts/ValueChart";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/format";
import type { ChartPoint, FundSlug } from "@/types/domain";

const PERIODS = [
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "YTD", value: "ytd" },
  { label: "1Y", value: "1y" },
  { label: "All", value: "all" },
] as const;

type Period = (typeof PERIODS)[number]["value"];

interface Props {
  fund: FundSlug;
  totalValue: number;
  dayChange: number;
  dayChangePct: number;
  benchmarkName: string;
}

function formatDateLabel(timeStr: string): string {
  const [y, m, d] = timeStr.split("-").map(Number);
  if (!y || !m || !d) return timeStr;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function DashboardCharts({
  fund,
  totalValue,
  dayChange,
  dayChangePct,
  benchmarkName,
}: Props) {
  const [period, setPeriod] = useState<Period>("3mo");
  const [points, setPoints] = useState<ChartPoint[] | null>(null);
  const [benchmark, setBenchmark] = useState<ChartPoint[]>([]);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<{ value: number; time: string } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setFailed(false);
    fetch(`/api/${fund}/portfolio/history?period=${period}`)
      .then((r) => {
        if (!r.ok) throw new Error(`history ${r.status}`);
        return r.json() as Promise<{
          points: ChartPoint[];
          benchmark: ChartPoint[];
        }>;
      })
      .then((json) => {
        if (cancelled) return;
        setPoints(json.points ?? []);
        setBenchmark(json.benchmark ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fund, period]);

  const handleCrosshairMove = useCallback(
    (value: number | null, time: string | null) => {
      setHovered(value !== null && time !== null ? { value, time } : null);
    },
    []
  );

  // Benchmark rebased to the fund's first value so both lines share a scale
  // and start together — an honest growth comparison, not raw index levels.
  const rebasedBenchmark = useMemo(() => {
    if (!points || points.length === 0 || benchmark.length === 0) return [];
    const scale = points[0].value / benchmark[0].value;
    if (!Number.isFinite(scale) || scale <= 0) return [];
    return benchmark.map((b) => ({ time: b.time, value: b.value * scale }));
  }, [points, benchmark]);

  const loaded = points !== null && !failed;
  const hasChart = loaded && points.length > 0;
  const first = hasChart ? points[0].value : totalValue;
  const last = hasChart ? points[points.length - 1].value : totalValue;
  const chartIsPositive = last >= first;

  const periodLabel =
    PERIODS.find((p) => p.value === period)?.label ?? period.toUpperCase();

  // Hovering: change from period start to the hovered point.
  // Not hovering: today's live day change from valueFund.
  const isHovering = hovered !== null && hasChart;
  const displayValue = isHovering ? hovered.value : totalValue;
  const displayChange = isHovering ? hovered.value - first : dayChange;
  const displayChangePct = isHovering
    ? first > 0
      ? ((hovered.value - first) / first) * 100
      : 0
    : dayChangePct;
  const displayPositive = displayChange >= 0;
  const displayLabel = isHovering ? formatDateLabel(hovered.time) : "Today";

  const benchChangePct =
    benchmark.length >= 2 && benchmark[0].value > 0
      ? ((benchmark[benchmark.length - 1].value - benchmark[0].value) /
          benchmark[0].value) *
        100
      : null;

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-4 pt-4 sm:px-6 sm:pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs tracking-wide text-muted sm:text-sm">
              Total fund value
            </p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums sm:text-3xl">
              {formatCurrency(displayValue)}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              {displayPositive ? (
                <TrendingUp className="h-3.5 w-3.5 text-gain" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5 text-loss" />
              )}
              <span
                className={`text-sm font-medium tabular-nums ${
                  displayPositive ? "text-gain" : "text-loss"
                }`}
              >
                {formatSignedCurrency(displayChange)} (
                {formatSignedPercent(displayChangePct)})
              </span>
              <span className="text-sm text-muted">{displayLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-1.5">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors sm:px-3 ${
                  period === p.value
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 px-1 pb-1">
        {failed ? (
          <div className="flex h-[160px] items-center justify-center sm:h-[200px]">
            <p className="text-xs text-muted">
              Could not load the chart — reload the page to retry.
            </p>
          </div>
        ) : points === null ? (
          <div className="px-3 pb-3">
            <Skeleton className="h-[150px] sm:h-[190px]" />
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-[160px] items-center justify-center px-6 text-center sm:h-[200px]">
            <p className="text-xs text-muted">
              No snapshots in this range yet — the chart fills in after the
              nightly snapshot runs on trading days.
            </p>
          </div>
        ) : (
          <ValueChart
            data={points}
            benchmark={rebasedBenchmark}
            isPositive={chartIsPositive}
            fund={fund}
            onCrosshairMove={handleCrosshairMove}
          />
        )}
      </div>

      {hasChart && rebasedBenchmark.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-1 border-t border-card-border/40 px-4 py-2.5 sm:px-6">
          <p className="text-xs text-muted">
            <span
              className="mr-1.5 inline-block h-0.5 w-4 bg-smif-gray align-middle"
              aria-hidden="true"
            />
            {benchmarkName}, rebased to the fund&apos;s {periodLabel} start
          </p>
          {benchChangePct !== null && (
            <p className="text-xs tabular-nums text-muted">
              {benchmarkName} {formatSignedPercent(benchChangePct)} · Fund{" "}
              {formatSignedPercent(
                first > 0 ? ((last - first) / first) * 100 : 0
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
