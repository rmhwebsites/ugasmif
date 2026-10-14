"use client";

// Horizontal grouped bars: current weight (accent) vs target (accent at 40%)
// vs benchmark weight (gray), one row per sector. All values are percents.
// Target and benchmark only appear once some sector has one: an empty series
// still reserves its slot in every row, which pushed the weight bar off its
// label, and its legend entry promised data that was not there.
// Rows whose data carries the sector's slug open that sector's page: the
// name is a real link (keyboard, middle-click), and the bars click through.

import { useRouter } from "next/navigation";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Text,
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
    /** The sector's slug; when present the row links to its page. */
    slug?: string | null;
  }[];
  fund: FundSlug;
}

function truncate(name: string, max = 26): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

export function SectorBarChart({ data, fund }: Props) {
  const { resolvedTheme } = useTheme();
  const theme = getChartTheme(resolvedTheme, fund);
  const router = useRouter();

  const hrefAt = (index: number): string | null => {
    const slug = data[index]?.slug;
    return slug ? `/${fund}/sectors/${slug}` : null;
  };
  // A bar hands back its own data row, so this reads the slug off it rather
  // than trusting the bar's position among the drawn rectangles.
  const openRow = (item: { payload?: { slug?: string | null } }) => {
    const slug = item.payload?.slug;
    if (slug) router.push(`/${fund}/sectors/${slug}`);
  };
  const linked = data.some((d) => d.slug);

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <p className="text-xs text-muted">No sector data yet</p>
      </div>
    );
  }

  const hasTarget = data.some((d) => d.target !== null);
  const hasBenchmark = data.some((d) => d.benchmark !== null);
  const series = 1 + Number(hasTarget) + Number(hasBenchmark);
  const height = Math.max(200, 40 + data.length * (series > 1 ? 52 : 40));

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
            width={132}
            tick={(props) => {
              // The axis's own label (same wrapping and placement as the
              // default tick), wrapped in a link when the row has a slug.
              const href = hrefAt(props.payload.index ?? props.index);
              const label = (
                <Text
                  {...props}
                  fill={theme.textColor}
                  fontSize={11}
                  className={
                    href
                      ? "recharts-cartesian-axis-tick-value hover:underline"
                      : "recharts-cartesian-axis-tick-value"
                  }
                >
                  {truncate(String(props.payload.value))}
                </Text>
              );
              if (!href) return label;
              return (
                <a
                  href={href}
                  aria-label={`Open ${String(props.payload.value)}`}
                  onClick={(e) => {
                    // Plain clicks stay in the app; modified clicks keep the
                    // browser's new-tab behaviour.
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                      return;
                    e.preventDefault();
                    router.push(href);
                  }}
                >
                  <title>{`Open ${String(props.payload.value)}`}</title>
                  {/* A 28px tall invisible target behind the 11px label, so
                      the name is easy to tap on a phone. Rows sit 40px or
                      more apart, so the targets never overlap. */}
                  <rect
                    x={Number(props.x) - 124}
                    y={Number(props.y) - 14}
                    width={128}
                    height={28}
                    fill="transparent"
                  />
                  {label}
                </a>
              );
            }}
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
          {series > 1 && (
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12 }}
            />
          )}
          <Bar
            dataKey="weight"
            name="Weight"
            fill={theme.accent}
            radius={[0, 3, 3, 0]}
            maxBarSize={10}
            cursor={linked ? "pointer" : undefined}
            onClick={openRow}
          />
          {hasTarget && (
            <Bar
              dataKey="target"
              name="Target"
              fill={theme.accent}
              fillOpacity={0.4}
              radius={[0, 3, 3, 0]}
              maxBarSize={10}
              cursor={linked ? "pointer" : undefined}
              onClick={openRow}
            />
          )}
          {hasBenchmark && (
            <Bar
              dataKey="benchmark"
              name="Benchmark"
              fill={theme.benchmark}
              radius={[0, 3, 3, 0]}
              maxBarSize={10}
              cursor={linked ? "pointer" : undefined}
              onClick={openRow}
            />
          )}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
