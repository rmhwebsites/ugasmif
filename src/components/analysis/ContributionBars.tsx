"use client";

// Which positions are actually driving the fund's gain (SPEC 14).
//
// A diverging bar from a centre line: winners right, losers left, longest bar
// = biggest dollar move. Ranked by absolute move so a large loss is as visible
// as a large gain, which is the point — a list sorted by gain descending
// buries exactly the position the committee needs to talk about.

import Link from "next/link";
import { SecurityLogo } from "@/components/holdings/SecurityLogo";
import { formatCurrencyWhole, formatSignedPercent } from "@/lib/format";
import type { PositionContribution } from "@/lib/analysis";

export function ContributionBars({
  rows,
  fund,
  limit = 8,
}: {
  rows: PositionContribution[];
  fund: string;
  limit?: number;
}) {
  const shown = rows.slice(0, limit);
  if (shown.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted sm:px-6">
        No positions to analyse yet.
      </p>
    );
  }

  // Scale every bar against the single biggest move, so the longest bar fills
  // its half and the rest are honestly proportional to it.
  const widest = Math.max(...shown.map((r) => Math.abs(r.gain)), 1);

  return (
    <ul className="divide-y divide-card-border/50">
      {shown.map((r) => {
        const positive = r.gain >= 0;
        const width = (Math.abs(r.gain) / widest) * 100;
        return (
          <li key={r.holdingId}>
            <Link
              href={`/${fund}/holdings/${r.holdingId}`}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-highlight sm:px-6"
            >
              <SecurityLogo symbol={r.symbol} name={r.name} size="sm" />
              {/* On a phone the label sits over its bars, so a bond's full
                  name fits. From sm up this wrapper drops out of the layout
                  and the label and bars share one row. */}
              <span className="min-w-0 flex-1 sm:contents">
                <span className="block break-words text-xs font-semibold sm:w-14 sm:shrink-0 sm:truncate sm:text-sm">
                  {r.label}
                </span>

                {/* Two half-width tracks meeting at a centre line: the loss
                    bar grows leftwards from it, the gain bar rightwards. */}
                <span className="mt-1 flex min-w-0 flex-1 items-center sm:mt-0">
                  <span className="flex h-2 flex-1 justify-end sm:h-5">
                    {!positive && (
                      <span
                        className="h-full rounded-l-sm bg-loss/70"
                        style={{ width: `${width}%` }}
                      />
                    )}
                  </span>
                  <span className="h-2 w-px shrink-0 bg-card-border sm:h-5" />
                  <span className="flex h-2 flex-1 sm:h-5">
                    {positive && (
                      <span
                        className="h-full rounded-r-sm bg-gain/70"
                        style={{ width: `${width}%` }}
                      />
                    )}
                  </span>
                </span>
              </span>

              <span className="w-24 shrink-0 text-right text-xs tabular-nums sm:text-sm">
                <span
                  className={`block font-medium ${
                    positive ? "text-gain" : "text-loss"
                  }`}
                >
                  {positive ? "+" : "−"}
                  {formatCurrencyWhole(Math.abs(r.gain))}
                </span>
                <span className="block text-[10px] text-muted">
                  {r.returnPct === null
                    ? "—"
                    : formatSignedPercent(r.returnPct)}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
