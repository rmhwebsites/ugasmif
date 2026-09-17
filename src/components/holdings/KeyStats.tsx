// Yahoo quoteSummary figures, formatted for display. Shared by the holding
// detail page and the pitch page so the two never drift apart on what "key
// stats" means or how a missing figure renders.

import { Card, CardHeader } from "@/components/ui/Card";
import { formatCurrency, formatNumber, formatPercent } from "@/lib/format";

/** Raw shape returned by getKeyStats() in src/lib/yahoo.ts. */
export type KeyStats = Record<string, number | string | null>;

export interface KeyStatItem {
  label: string;
  value: string;
}

function compact(value: number | null): string {
  return value === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
}

export function keyStatItems(stats: KeyStats): KeyStatItem[] {
  const num = (key: string): number | null => {
    const value = stats[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const marketCap = num("marketCap");
  return [
    {
      label: "Market Cap",
      value: marketCap === null ? "—" : `$${compact(marketCap)}`,
    },
    { label: "P/E (TTM)", value: formatNumber(num("trailingPE"), 1) },
    { label: "Forward P/E", value: formatNumber(num("forwardPE"), 1) },
    { label: "Dividend Yield", value: formatPercent(num("dividendYield"), 2) },
    { label: "Beta", value: formatNumber(num("beta"), 2) },
    { label: "52W High", value: formatCurrency(num("fiftyTwoWeekHigh")) },
    { label: "52W Low", value: formatCurrency(num("fiftyTwoWeekLow")) },
    { label: "Avg Volume", value: compact(num("averageVolume")) },
  ];
}

export function hasKeyStats(items: KeyStatItem[]): boolean {
  return items.some((item) => item.value !== "—");
}

export function KeyStatsCard({
  stats,
  symbol,
}: {
  stats: KeyStats;
  symbol: string;
}) {
  const items = keyStatItems(stats);
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Key Stats" />
      {hasKeyStats(items) ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 p-4 sm:grid-cols-4 sm:p-6">
          {items.map((item) => (
            <div key={item.label}>
              <p className="text-[11px] uppercase tracking-wider text-muted">
                {item.label}
              </p>
              <p className="mt-0.5 text-sm font-medium tabular-nums sm:text-base">
                {item.value}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="p-6 text-sm text-muted">
          Key stats are unavailable right now — Yahoo Finance did not return
          data for {symbol}. Refresh in a minute.
        </p>
      )}
    </Card>
  );
}
