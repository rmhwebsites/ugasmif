"use client";

// Treasury yield strip for the Arch dashboard: 13W / 5Y / 10Y / 30Y yields
// from /api/market/rates with the day change in yield points colored
// gain/loss. Rates refresh with the quote cache, so a single fetch per
// mount is enough.

import { useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatNumber, formatPercent } from "@/lib/format";

interface Rate {
  symbol: string;
  label: string;
  yieldPct: number | null;
  change: number | null;
}

export function RatesStrip() {
  const [rates, setRates] = useState<Rate[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/market/rates")
      .then((r) => {
        if (!r.ok) throw new Error(`rates ${r.status}`);
        return r.json() as Promise<{ rates: Rate[] }>;
      })
      .then((json) => {
        if (!cancelled) setRates(json.rates ?? []);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="glass-card px-4 py-3 sm:px-6">
      <p className="text-[11px] uppercase tracking-wider text-muted sm:text-xs">
        Treasury yields
      </p>
      {failed ? (
        <p className="mt-2 text-sm text-muted">
          Rates are unavailable right now — reload the page to retry.
        </p>
      ) : rates === null ? (
        <div className="mt-2 grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-4 gap-3">
          {rates.map((r) => {
            const change = r.change;
            const changeClass =
              change === null || change === 0
                ? "text-muted"
                : change > 0
                ? "text-gain"
                : "text-loss";
            return (
              <div key={r.symbol}>
                <p className="text-xs text-muted">{r.label}</p>
                <p className="text-sm font-semibold tabular-nums sm:text-base">
                  {r.yieldPct !== null ? formatPercent(r.yieldPct, 2) : "—"}
                </p>
                <p className={`text-xs tabular-nums ${changeClass}`}>
                  {change !== null
                    ? `${change > 0 ? "+" : ""}${formatNumber(change, 2)}`
                    : "—"}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
