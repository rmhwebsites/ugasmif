"use client";

// Horizontal grouped bars: current weight (accent) vs target (accent at 40%)
// vs benchmark weight (gray), one row per sector. All values are percents.

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "@/components/providers/ThemeProvider";
import { getChartTheme } from "@/lib/chartTheme";
import { formatPercent } from "@/lib/format";
import type { FundSlug } from "@/types/domain";

interface Props {
  data: {
    name: string;
    weight: number;
    target: number | null;
    benchmark: number | null;
  }[];
  fund: FundSlug;
}

function truncate(name: string, max = 16): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function SectorBarChart({ data, fund }: Props) {
  const { resolvedTheme } = useTheme();
  const theme = getChartTheme(resolvedTheme, fund);

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="text-xs text-muted">No sector data yet</p>
      </div>
    );
  }

  const height = Math.max(200, 40 + data.length * 52);

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
          barCategoryGap="28%"
          barGap={2}
        >
          <XAxis
            type="number"
            tickFormatter={(v: number) => `${v}%`}
            tick={{ fill: theme.textColorSubtle, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            domain={[0, "auto"]}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={118}
            tickFormatter={(v: string) => truncate(v)}
            tick={{ fill: theme.textColor, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
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
            cursor={{ fill: theme.gridColor }}
            formatter={(
              value: number | string | ReadonlyArray<number | string> | undefined,
              name: string | number | undefined
            ): [string, string] => [
              formatPercent(Number(value)),
              String(name ?? ""),
            ]}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12 }}
          />
          <Bar
            dataKey="weight"
            name="Weight"
            fill={theme.accent}
            radius={[0, 3, 3, 0]}
            maxBarSize={10}
          />
          <Bar
            dataKey="target"
            name="Target"
            fill={theme.accent}
            fillOpacity={0.4}
            radius={[0, 3, 3, 0]}
            maxBarSize={10}
          />
          <Bar
            dataKey="benchmark"
            name="Benchmark"
            fill={theme.benchmark}
            radius={[0, 3, 3, 0]}
            maxBarSize={10}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
