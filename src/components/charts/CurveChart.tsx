"use client";

// Treasury curve: yield (%) against tenor, one line per series label (e.g.
// the latest curve date vs ~one month prior). Tenors render as an ordered
// category axis — evenly spaced points read like the conventional log-ish
// curve layout instead of squashing the short end.

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "@/components/providers/ThemeProvider";
import { getChartTheme, GAIN_COLOR, LOSS_COLOR } from "@/lib/chartTheme";
import { formatPercent } from "@/lib/format";
import type { FundSlug } from "@/types/domain";

interface Props {
  series: {
    label: string;
    points: { tenorYears: number; yieldPct: number }[];
  }[];
  fund: FundSlug;
}

function tenorLabel(tenorYears: number): string {
  if (tenorYears < 1) return `${Math.round(tenorYears * 12)}M`;
  return Number.isInteger(tenorYears) ? `${tenorYears}Y` : `${tenorYears.toFixed(1)}Y`;
}

export function CurveChart({ series, fund }: Props) {
  const { resolvedTheme } = useTheme();
  const theme = getChartTheme(resolvedTheme, fund);

  const nonEmpty = series.filter((s) => s.points.length > 0);
  if (nonEmpty.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-xs text-muted">
          No curve data yet — the Treasury feed loads with the nightly cron
        </p>
      </div>
    );
  }

  const tenors = [
    ...new Set(nonEmpty.flatMap((s) => s.points.map((p) => p.tenorYears))),
  ].sort((a, b) => a - b);

  const rows = tenors.map((t) => {
    const row: Record<string, string | number | null> = { tenor: tenorLabel(t) };
    for (const s of nonEmpty) {
      const pt = s.points.find((p) => p.tenorYears === t);
      row[s.label] = pt ? pt.yieldPct : null;
    }
    return row;
  });

  const palette = [theme.accent, theme.benchmark, GAIN_COLOR, LOSS_COLOR];

  return (
    <div className="h-56 sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={rows}
          margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
        >
          <XAxis
            dataKey="tenor"
            tick={{ fill: theme.textColorSubtle, fontSize: 11 }}
            axisLine={{ stroke: theme.borderColor }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: theme.textColorSubtle, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={["auto", "auto"]}
          />
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
            formatter={(
              value: number | string | ReadonlyArray<number | string> | undefined,
              name: string | number | undefined
            ): [string, string] => [
              formatPercent(Number(value), 2),
              String(name ?? ""),
            ]}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          {nonEmpty.map((s, i) => (
            <Line
              key={s.label}
              type="monotone"
              dataKey={s.label}
              stroke={palette[i % palette.length]}
              strokeWidth={2}
              dot={{ r: 2.5, strokeWidth: 0, fill: palette[i % palette.length] }}
              activeDot={{ r: 4 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
