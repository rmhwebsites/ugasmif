"use client";

// Lightweight Charts v5 area chart (ported from GBH FundValueChart): fund
// line colored gain green / loss red by isPositive, optional benchmark
// overlay as a thin gray LineSeries, crosshair callback per CONTRACTS.md.
// The benchmark series is plotted on the same scale as `data`, so callers
// pass comparable series (rebased dollars, or growth-of-$1).

import { useEffect, useMemo, useRef } from "react";
import {
  createChart,
  ColorType,
  AreaSeries,
  LineSeries,
  isBusinessDay,
  isUTCTimestamp,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import { useTheme } from "@/components/providers/ThemeProvider";
import { getChartTheme, GAIN_COLOR, LOSS_COLOR } from "@/lib/chartTheme";
import type { ChartPoint, FundSlug } from "@/types/domain";

interface Props {
  data: ChartPoint[];
  benchmark?: ChartPoint[];
  isPositive: boolean;
  fund: FundSlug;
  onCrosshairMove?: (v: number | null, t: string | null) => void;
  height?: number;
  /** Show the right price scale (drawdown / duration charts). Default false. */
  showPriceScale?: boolean;
}

/** lightweight-charts Time → "YYYY-MM-DD". */
function timeToDateString(time: Time): string {
  if (typeof time === "string") return time;
  if (isBusinessDay(time)) {
    return `${time.year}-${String(time.month).padStart(2, "0")}-${String(
      time.day
    ).padStart(2, "0")}`;
  }
  if (isUTCTimestamp(time)) {
    return new Date(time * 1000).toISOString().slice(0, 10);
  }
  return "";
}

/** Ascending, one point per date — lightweight-charts rejects anything else. */
function normalize(points: ChartPoint[]): ChartPoint[] {
  const byTime = new Map<string, number>();
  for (const p of points) {
    if (Number.isFinite(p.value)) byTime.set(p.time.slice(0, 10), p.value);
  }
  return [...byTime.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([time, value]) => ({ time, value }));
}

export function ValueChart({
  data,
  benchmark,
  isPositive,
  fund,
  onCrosshairMove,
  height,
  showPriceScale = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const { resolvedTheme } = useTheme();

  // Keep the latest callback in a ref so changing identity never rebuilds
  // the chart.
  const crosshairCbRef = useRef<Props["onCrosshairMove"]>(onCrosshairMove);
  useEffect(() => {
    crosshairCbRef.current = onCrosshairMove;
  }, [onCrosshairMove]);

  const series = useMemo(() => normalize(data), [data]);
  const benchSeries = useMemo(
    () => (benchmark ? normalize(benchmark) : []),
    [benchmark]
  );

  useEffect(() => {
    if (!containerRef.current || series.length === 0) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const lineColor = isPositive ? GAIN_COLOR : LOSS_COLOR;
    const isMobile = window.innerWidth < 640;
    const chartHeight = height ?? (isMobile ? 160 : 200);
    const colors = getChartTheme(resolvedTheme, fund);

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.textColorSubtle,
        fontFamily: "'Inter', 'Roboto', sans-serif",
        fontSize: isMobile ? 9 : 11,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      crosshair: {
        vertLine: {
          color: colors.borderColor,
          width: 1,
          style: 0,
          labelVisible: false,
        },
        horzLine: { visible: false, labelVisible: false },
      },
      rightPriceScale: {
        visible: showPriceScale,
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        timeVisible: false,
      },
      handleScroll: { mouseWheel: false, pressedMouseMove: true },
      handleScale: false,
      width: containerRef.current.clientWidth,
      height: chartHeight,
    });
    chartRef.current = chart;

    const areaSeries: ISeriesApi<"Area"> = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: isPositive
        ? "rgba(34, 197, 94, 0.28)"
        : "rgba(239, 68, 68, 0.28)",
      bottomColor: isPositive
        ? "rgba(34, 197, 94, 0.0)"
        : "rgba(239, 68, 68, 0.0)",
      lineWidth: 2,
      lineType: 2, // curved
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 5,
      crosshairMarkerBorderColor: lineColor,
      crosshairMarkerBackgroundColor: "#ffffff",
      crosshairMarkerBorderWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    areaSeries.setData(series.map((p) => ({ time: p.time, value: p.value })));

    if (benchSeries.length > 0) {
      const benchLine = chart.addSeries(LineSeries, {
        color: colors.benchmark,
        lineWidth: 1,
        lineType: 2,
        crosshairMarkerVisible: false,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      benchLine.setData(
        benchSeries.map((p) => ({ time: p.time, value: p.value }))
      );
    }

    chart.timeScale().fitContent();

    const handleCrosshair = (param: MouseEventParams) => {
      const cb = crosshairCbRef.current;
      if (!cb) return;
      if (param.time === undefined || param.seriesData.size === 0) {
        cb(null, null);
        return;
      }
      const datum = param.seriesData.get(areaSeries);
      if (datum && "value" in datum && typeof datum.value === "number") {
        cb(datum.value, timeToDateString(param.time));
      } else {
        cb(null, null);
      }
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        const nowMobile = window.innerWidth < 640;
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
          height: height ?? (nowMobile ? 160 : 200),
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartRef.current) {
        chartRef.current.unsubscribeCrosshairMove(handleCrosshair);
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [series, benchSeries, isPositive, fund, resolvedTheme, height, showPriceScale]);

  if (series.length === 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: height ?? 200 }}
      >
        <p className="text-xs text-muted">No chart data yet</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full"
      style={{ touchAction: "pan-y" }}
    />
  );
}
