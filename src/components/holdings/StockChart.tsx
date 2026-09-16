"use client";

// Price chart for the equity/ETF detail page (SPEC 11.2): Lightweight Charts
// v5 area series fed from /api/market/history/[symbol], with a
// 1D 5D 1M 6M YTD 1Y 5Y ALL period selector. Intraday periods come back as
// ISO timestamps and are plotted as UTC timestamps with times visible;
// daily/weekly periods plot as date strings. Line color follows the period's
// direction (gain green / loss red), matching the dashboard ValueChart.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type IChartApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useTheme } from "@/components/providers/ThemeProvider";
import { GAIN_COLOR, LOSS_COLOR, getChartTheme } from "@/lib/chartTheme";
import { SmifSpinner } from "@/components/ui/SmifSpinner";
import { formatCurrency, formatSignedPercent } from "@/lib/format";
import type { FundSlug } from "@/types/domain";

type ChartPeriod = "1d" | "5d" | "1mo" | "6mo" | "ytd" | "1y" | "5y" | "max";

const PERIODS: { label: string; value: ChartPeriod }[] = [
  { label: "1D", value: "1d" },
  { label: "5D", value: "5d" },
  { label: "1M", value: "1mo" },
  { label: "6M", value: "6mo" },
  { label: "YTD", value: "ytd" },
  { label: "1Y", value: "1y" },
  { label: "5Y", value: "5y" },
  { label: "ALL", value: "max" },
];

/** Response shape of GET /api/market/history/[symbol] (CONTRACTS.md). */
interface HistoryPointDto {
  time: string;
  close: number;
  adjClose: number | null;
}

interface SeriesPoint {
  time: Time;
  value: number;
}

export function StockChart({
  symbol,
  fund,
}: {
  symbol: string;
  fund: FundSlug;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();

  const [period, setPeriod] = useState<ChartPeriod>("1y");
  // The result carries the request it answers, so changing symbol or period
  // falls back to the skeleton without resetting state inside the effect.
  const [result, setResult] = useState<{
    key: string;
    points: HistoryPointDto[];
    error: string | null;
  } | null>(null);

  const requestKey = `${symbol}:${period}`;

  // Fetch history when symbol/period change.
  useEffect(() => {
    const controller = new AbortController();
    const key = `${symbol}:${period}`;
    fetch(
      `/api/market/history/${encodeURIComponent(symbol)}?period=${period}`,
      { signal: controller.signal }
    )
      .then(async (res) => {
        if (!res.ok) throw new Error(`history request failed (${res.status})`);
        const body = (await res.json()) as { points?: HistoryPointDto[] };
        setResult({ key, points: body.points ?? [], error: null });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error(`stock history failed for ${symbol}:`, err);
        setResult({
          key,
          points: [],
          error:
            "Chart data is unavailable right now. Try another period or refresh.",
        });
      });
    return () => controller.abort();
  }, [symbol, period]);

  const current = result?.key === requestKey ? result : null;
  const points = current?.points ?? null;
  const error = current?.error ?? null;

  // Deduped, ascending series. Intraday ISO timestamps → UTCTimestamp.
  const { series, intraday } = useMemo((): {
    series: SeriesPoint[];
    intraday: boolean;
  } => {
    if (!points) return { series: [], intraday: false };
    const isIntraday = points.some((p) => p.time.includes("T"));
    const byTime = new Map<string | number, SeriesPoint>();
    for (const p of points) {
      if (typeof p.close !== "number" || !Number.isFinite(p.close)) continue;
      if (isIntraday) {
        const ms = Date.parse(p.time);
        if (!Number.isFinite(ms)) continue;
        const ts = Math.floor(ms / 1000);
        byTime.set(ts, { time: ts as UTCTimestamp, value: p.close });
      } else {
        const day = p.time.slice(0, 10);
        byTime.set(day, { time: day, value: p.close });
      }
    }
    const series = [...byTime.values()].sort((a, b) => {
      if (typeof a.time === "number" && typeof b.time === "number") {
        return a.time - b.time;
      }
      return String(a.time).localeCompare(String(b.time));
    });
    return { series, intraday: isIntraday };
  }, [points]);

  const periodChangePct = useMemo(() => {
    if (series.length < 2) return null;
    const first = series[0].value;
    const last = series[series.length - 1].value;
    return first > 0 ? ((last - first) / first) * 100 : null;
  }, [series]);

  // Build/rebuild the chart when data or theme change.
  useEffect(() => {
    if (!containerRef.current || series.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const colors = getChartTheme(resolvedTheme, fund);
    const positive = periodChangePct === null || periodChangePct >= 0;
    const lineColor = positive ? GAIN_COLOR : LOSS_COLOR;
    const isMobile = window.innerWidth < 640;
    const chartHeight = isMobile ? 260 : 360;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.textColorSubtle,
        fontFamily: "'Inter', 'Roboto', sans-serif",
        fontSize: isMobile ? 10 : 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: colors.gridColor },
      },
      crosshair: {
        vertLine: {
          color: colors.crosshairColor,
          labelBackgroundColor: colors.accent,
        },
        horzLine: {
          color: colors.crosshairColor,
          labelBackgroundColor: colors.accent,
        },
      },
      localization: {
        priceFormatter: (price: number) => formatCurrency(price),
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: intraday,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true },
      handleScale: false,
      width: containerRef.current.clientWidth,
      height: chartHeight,
    });
    chartRef.current = chart;

    const areaSeries = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: positive
        ? "rgba(34, 197, 94, 0.25)"
        : "rgba(239, 68, 68, 0.25)",
      bottomColor: positive
        ? "rgba(34, 197, 94, 0.0)"
        : "rgba(239, 68, 68, 0.0)",
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: lineColor,
      crosshairMarkerBackgroundColor: "#ffffff",
      priceLineVisible: false,
      lastValueVisible: true,
    });
    areaSeries.setData(series);
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        const nowMobile = window.innerWidth < 640;
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: nowMobile ? 260 : 360,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [series, intraday, periodChangePct, resolvedTheme, fund]);

  const loading = points === null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setPeriod(p.value)}
              className={`cursor-pointer rounded-lg px-2 py-1 text-xs font-medium transition-colors sm:px-2.5 sm:py-1.5 ${
                period === p.value
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-highlight hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {periodChangePct !== null && (
          <span
            className={`text-xs font-medium tabular-nums sm:text-sm ${
              periodChangePct >= 0 ? "text-gain" : "text-loss"
            }`}
          >
            {formatSignedPercent(periodChangePct)}{" "}
            {PERIODS.find((p) => p.value === period)?.label ?? ""}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex h-[260px] items-center justify-center sm:h-[360px]">
          <SmifSpinner size="md" label="Loading price history" />
        </div>
      ) : error ? (
        <div className="flex h-[260px] items-center justify-center sm:h-[360px]">
          <p className="max-w-xs text-center text-xs text-muted">{error}</p>
        </div>
      ) : series.length === 0 ? (
        <div className="flex h-[260px] items-center justify-center sm:h-[360px]">
          <p className="text-xs text-muted">
            No chart data for this period — try a longer one.
          </p>
        </div>
      ) : (
        <div
          ref={containerRef}
          className="w-full"
          style={{ touchAction: "pan-y" }}
        />
      )}
    </div>
  );
}
