"use client";

// How much of the fund rides on its largest positions (SPEC 14, "risk:
// concentration, top 5 and top 10 weight").
//
// The cumulative curve says more than the two numbers do: a steep start means
// a handful of names carry the fund, a straight diagonal means it is evenly
// spread. The 5 and 10 marks are called out because those are the two the
// committee quotes.

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "@/components/providers/ThemeProvider";
import { getChartTheme } from "@/lib/chartTheme";
import { formatPercent } from "@/lib/format";
import type { ConcentrationPoint } from "@/lib/analysis";
import type { FundSlug } from "@/types/domain";

export function ConcentrationChart({
  points,
  fund,
}: {
  points: ConcentrationPoint[];
  fund: FundSlug;
}) {
  const { resolvedTheme } = useTheme();
  const theme = getChartTheme(resolvedTheme, fund);

  if (points.length < 3) {
    return (
      <p className="py-8 text-center text-xs text-muted">
        The curve needs at least three positions.
      </p>
    );
  }

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 4, left: -18 }}
        >
          <defs>
            <linearGradient id="conc" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={theme.accent} stopOpacity={0.35} />
              <stop offset="100%" stopColor={theme.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={theme.gridColor} vertical={false} />
          <XAxis
            dataKey="n"
            tick={{ fill: theme.textColorSubtle, fontSize: 11 }}
            axisLine={{ stroke: theme.borderColor }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => `${Math.round(v)}%`}
            tick={{ fill: theme.textColorSubtle, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={[0, 100]}
          />
          {points.length >= 5 && (
            <ReferenceLine
              x={5}
              stroke={theme.borderColor}
              strokeDasharray="3 3"
              label={{ value: "top 5", fill: theme.textColorSubtle, fontSize: 10, position: "top" }}
            />
          )}
          {points.length >= 10 && (
            <ReferenceLine
              x={10}
              stroke={theme.borderColor}
              strokeDasharray="3 3"
              label={{ value: "top 10", fill: theme.textColorSubtle, fontSize: 10, position: "top" }}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: theme.tooltipBg,
              border: `1px solid ${theme.tooltipBorder}`,
              borderRadius: "8px",
              fontSize: "13px",
              padding: "8px 12px",
            }}
            itemStyle={{ color: theme.tooltipText }}
            labelStyle={{ color: theme.tooltipText, fontWeight: 600 }}
            labelFormatter={(label: React.ReactNode) =>
              `Largest ${String(label ?? "")} positions`
            }
            formatter={(
              value: number | string | ReadonlyArray<number | string> | undefined
            ): [string, string] => [formatPercent(Number(value)), "of the fund"]}
          />
          <Area
            type="monotone"
            dataKey="cumulativeWeightPct"
            stroke={theme.accent}
            strokeWidth={2}
            fill="url(#conc)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
