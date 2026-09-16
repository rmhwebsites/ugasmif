"use client";

// Performance page chart cards (client so the crosshair readouts work):
// cumulative growth-of-$1 for fund vs benchmark, and the drawdown-from-peak
// chart. Series are computed server-side in @/lib/performance and passed in.

import { useCallback, useState } from "react";
import { ValueChart } from "@/components/charts/ValueChart";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatPercent, formatSignedPercent } from "@/lib/format";
import type { ChartPoint, FundSlug } from "@/types/domain";

interface Props {
  fund: FundSlug;
  growth: ChartPoint[];
  benchmarkGrowth: ChartPoint[];
  drawdown: ChartPoint[];
  benchmarkName: string;
}

function dateLabel(timeStr: string): string {
  const [y, m, d] = timeStr.split("-").map(Number);
  if (!y || !m || !d) return timeStr;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function PerformanceView({
  fund,
  growth,
  benchmarkGrowth,
  drawdown,
  benchmarkName,
}: Props) {
  const [hovered, setHovered] = useState<{ value: number; time: string } | null>(
    null
  );

  const handleCrosshair = useCallback(
    (value: number | null, time: string | null) => {
      setHovered(value !== null && time !== null ? { value, time } : null);
    },
    []
  );

  const lastGrowth = growth.length > 0 ? growth[growth.length - 1].value : 1;
  const lastBench =
    benchmarkGrowth.length > 0
      ? benchmarkGrowth[benchmarkGrowth.length - 1].value
      : null;

  const shownGrowth = hovered ? hovered.value : lastGrowth;
  const shownLabel = hovered
    ? dateLabel(hovered.time)
    : growth.length > 0
    ? `Since ${dateLabel(growth[0].time)}`
    : "";

  const currentDrawdown =
    drawdown.length > 0 ? drawdown[drawdown.length - 1].value : 0;
  const maxDrawdown = drawdown.reduce((m, p) => Math.min(m, p.value), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <Card className="overflow-hidden">
        <CardHeader
          title="Growth of $1"
          action={
            <span className="text-xs text-muted">vs {benchmarkName}</span>
          }
        />
        <div className="px-4 pt-3 sm:px-6">
          <p className="text-2xl font-bold tabular-nums">
            ${shownGrowth.toFixed(2)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            <span
              className={
                shownGrowth >= 1 ? "text-gain" : "text-loss"
              }
            >
              {formatSignedPercent((shownGrowth - 1) * 100)}
            </span>{" "}
            {shownLabel}
            {!hovered && lastBench !== null && (
              <span>
                {" "}
                · {benchmarkName} {formatSignedPercent((lastBench - 1) * 100)}
              </span>
            )}
          </p>
        </div>
        <div className="mt-2 px-1 pb-2">
          <ValueChart
            data={growth}
            benchmark={benchmarkGrowth}
            isPositive={lastGrowth >= 1}
            fund={fund}
            onCrosshairMove={handleCrosshair}
            height={190}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader
          title="Drawdown"
          action={
            <span className="text-xs tabular-nums text-muted">
              Max {formatPercent(Math.abs(maxDrawdown))}
            </span>
          }
        />
        <div className="px-4 pt-3 sm:px-6">
          <p className="text-2xl font-bold tabular-nums text-loss">
            {formatPercent(currentDrawdown)}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Current distance from the fund&apos;s peak value
          </p>
        </div>
        <div className="mt-2 px-1 pb-2">
          <ValueChart
            data={drawdown}
            isPositive={false}
            fund={fund}
            height={190}
            showPriceScale
          />
        </div>
      </Card>
    </div>
  );
}
