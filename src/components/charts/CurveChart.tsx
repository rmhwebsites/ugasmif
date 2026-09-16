"use client";

// Treasury curve, in two shapes of the same line chart:
//   `history` — 2y/5y/10y/30y yields over time, one line per tenor, curve_date
//               on the X axis (SPEC 14). What /[fund]/performance plots.
//   `series`  — the curve's shape: yield against tenor for one or more curve
//               dates (the CONTRACTS.md prop). Tenors render as an ordered
//               category axis so the short end is not squashed.
// `history` wins when both are passed. Line colors stay inside the fund accent
// and the benchmark gray — green/red mean gain/loss everywhere else (SPEC 11.4).

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
import { getChartTheme } from "@/lib/chartTheme";
import { formatPercent } from "@/lib/format";
import type { FundSlug } from "@/types/domain";

export interface CurveShapeSeries {
  label: string;
  points: { tenorYears: number; yieldPct: number }[];
}

export interface CurveHistorySeries {
  label: string;
  points: { date: string; yieldPct: number }[];
}

interface Props {
  fund: FundSlug;
  series?: CurveShapeSeries[];
  history?: CurveHistorySeries[];
}

// Row key for the X value. Prefixed so it can never collide with a series
// label, which is also a dataKey on the same row.
const X = "__x";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-09-16" → "Sep 16" straight off the string, so no timezone shifts it. */
function dateTick(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

function dateLabel(iso: string): string {
  const [y] = iso.split("-");
  return `${dateTick(iso)}, ${y}`;
}

function tenorLabel(tenorYears: number): string {
  if (tenorYears < 1) return `${Math.round(tenorYears * 12)}M`;
  return Number.isInteger(tenorYears) ? `${tenorYears}Y` : `${tenorYears.toFixed(1)}Y`;
}

export function CurveChart({ fund, series, history }: Props) {
  const { resolvedTheme } = useTheme();
  const theme = getChartTheme(resolvedTheme, fund);

  const historySeries = (history ?? []).filter((s) => s.points.length > 0);
  const shapeSeries = (series ?? []).filter((s) => s.points.length > 0);
  const isHistory = historySeries.length > 0;
  const labels = (isHistory ? historySeries : shapeSeries).map((s) => s.label);

  if (labels.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center">
        <p className="text-xs text-muted">
          No curve data yet — the Treasury feed loads with the nightly cron
        </p>
      </div>
    );
  }

  let rows: Record<string, string | number | null>[];
  if (isHistory) {
    const byDate = new Map<string, Record<string, string | number | null>>();
    for (const s of historySeries) {
      for (const p of s.points) {
        let row = byDate.get(p.date);
        if (!row) {
          row = { [X]: p.date };
          byDate.set(p.date, row);
        }
        row[s.label] = p.yieldPct;
      }
    }
    rows = [...byDate.values()].sort((a, b) =>
      String(a[X]).localeCompare(String(b[X]))
    );
  } else {
    const tenors = [
      ...new Set(shapeSeries.flatMap((s) => s.points.map((p) => p.tenorYears))),
    ].sort((a, b) => a - b);
    rows = tenors.map((t) => {
      const row: Record<string, string | number | null> = { [X]: tenorLabel(t) };
      for (const s of shapeSeries) {
        const pt = s.points.find((p) => p.tenorYears === t);
        row[s.label] = pt ? pt.yieldPct : null;
      }
      return row;
    });
  }

  const strokes = [
    { color: theme.accent, opacity: 1, dash: undefined },
    { color: theme.benchmark, opacity: 1, dash: undefined },
    { color: theme.accent, opacity: 0.55, dash: undefined },
    { color: theme.benchmark, opacity: 1, dash: "4 3" },
  ];

  return (
    <div className="h-56 sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
          <XAxis
            dataKey={X}
            tick={{ fill: theme.textColorSubtle, fontSize: 11 }}
            axisLine={{ stroke: theme.borderColor }}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={isHistory ? 44 : 5}
            tickFormatter={(v: string) => (isHistory ? dateTick(v) : v)}
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
            labelFormatter={(label: React.ReactNode) =>
              isHistory ? dateLabel(String(label ?? "")) : String(label ?? "")
            }
            formatter={(
              value: number | string | ReadonlyArray<number | string> | undefined,
              name: string | number | undefined
            ): [string, string] => [
              formatPercent(Number(value), 2),
              String(name ?? ""),
            ]}
          />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
          {labels.map((label, i) => {
            const stroke = strokes[i % strokes.length];
            return (
              <Line
                key={label}
                type="monotone"
                dataKey={label}
                stroke={stroke.color}
                strokeOpacity={stroke.opacity}
                strokeDasharray={stroke.dash}
                strokeWidth={2}
                dot={
                  isHistory
                    ? false
                    : { r: 2.5, strokeWidth: 0, fill: stroke.color }
                }
                activeDot={{ r: 4 }}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
