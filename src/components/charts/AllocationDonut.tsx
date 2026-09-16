"use client";

// Recharts donut with a palette derived from the fund accent: Athena gets a
// reds/grays ramp off UGA red, Arch gets golds/graphite off the GBH gold.
// Shades are generated in code (accent hue at varying lightness, interleaved
// with near-neutral grays of the same hue) so any slice count stays legible.

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useTheme } from "@/components/providers/ThemeProvider";
import { getChartTheme } from "@/lib/chartTheme";
import { formatCurrency, formatPercent } from "@/lib/format";
import type { FundSlug } from "@/types/domain";

interface Props {
  data: { name: string; value: number }[];
  fund: FundSlug;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16) / 255;
  const g = parseInt(m.slice(2, 4), 16) / 255;
  const b = parseInt(m.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

/** Accent-derived ramp: even slices accent shades, odd slices gray/graphite. */
function buildPalette(
  accent: string,
  count: number,
  resolved: "light" | "dark"
): string[] {
  const { h, s } = hexToHsl(accent);
  const hue = Math.round(h);
  const sat = Math.round(Math.min(s, 78));
  const accentL =
    resolved === "dark" ? [48, 62, 36, 72, 28] : [42, 56, 30, 66, 22];
  const grayL = resolved === "dark" ? [66, 46, 80, 34] : [48, 34, 66, 24];
  const colors: string[] = [];
  let ai = 0;
  let gi = 0;
  for (let i = 0; i < count; i += 1) {
    if (i % 2 === 0) {
      colors.push(`hsl(${hue}, ${sat}%, ${accentL[ai % accentL.length]}%)`);
      ai += 1;
    } else {
      colors.push(`hsl(${hue}, 8%, ${grayL[gi % grayL.length]}%)`);
      gi += 1;
    }
  }
  return colors;
}

export function AllocationDonut({ data, fund }: Props) {
  const { resolvedTheme } = useTheme();
  const theme = getChartTheme(resolvedTheme, fund);

  const rows = data
    .filter((d) => Number.isFinite(d.value) && d.value > 0)
    .sort((a, b) => b.value - a.value);
  const total = rows.reduce((s, d) => s + d.value, 0);

  if (rows.length === 0 || total <= 0) {
    return (
      <div className="flex h-52 items-center justify-center sm:h-64">
        <p className="text-xs text-muted">Nothing to allocate yet</p>
      </div>
    );
  }

  const palette = buildPalette(theme.accent, rows.length, resolvedTheme);
  const slices = rows.map((d, i) => ({
    ...d,
    pct: (d.value / total) * 100,
    color: palette[i],
  }));

  return (
    <div>
      <div className="h-48 sm:h-56">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={78}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {slices.map((entry) => (
                <Cell key={entry.name} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: theme.tooltipBg,
                border: `1px solid ${theme.tooltipBorder}`,
                borderRadius: "8px",
                fontSize: "13px",
                padding: "8px 12px",
              }}
              itemStyle={{ color: theme.tooltipText }}
              labelStyle={{ color: theme.tooltipText }}
              cursor={{ fill: "transparent" }}
              formatter={(
                value: number | string | ReadonlyArray<number | string> | undefined,
                name: string | number | undefined
              ): [string, string] => {
                const v = Number(value);
                const pct = total > 0 ? (v / total) * 100 : 0;
                return [
                  `${formatCurrency(v)} (${formatPercent(pct)})`,
                  String(name ?? ""),
                ];
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {slices.map((item) => (
          <div
            key={item.name}
            className="flex min-w-0 items-center gap-2 text-xs"
          >
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            <span className="truncate text-muted">{item.name}</span>
            <span className="ml-auto shrink-0 font-medium tabular-nums">
              {formatPercent(item.pct)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
