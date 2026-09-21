"use client";

// What is actually inside a sector (SPEC 11.2). The sector page already shows
// the sector's weight against its target; this answers the next question the
// committee asks, which is what that weight is made of.
//
// Two halves: each position's share OF THE SECTOR — not of the fund, which is
// the number already at the top of the page — and the same contribution ranking
// the performance page uses, scoped to this sector.

import Link from "next/link";
import { SecurityLogo } from "@/components/holdings/SecurityLogo";
import { formatCurrencyWhole, formatPercent } from "@/lib/format";
import type { weightsWithinGroup } from "@/lib/analysis";

type Row = ReturnType<typeof weightsWithinGroup>[number];

export function SectorWeights({ rows, fund }: { rows: Row[]; fund: string }) {
  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted sm:px-6">
        No positions in this sector yet.
      </p>
    );
  }
  // Scale to the largest holding rather than to 100%, so a sector of ten even
  // positions still shows a readable bar instead of ten 10% slivers.
  const widest = Math.max(...rows.map((r) => r.sharePct), 1);

  return (
    <ul className="divide-y divide-card-border/50">
      {rows.map((r) => (
        <li key={r.holdingId}>
          <Link
            href={`/${fund}/holdings/${r.holdingId}`}
            className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-highlight sm:px-6"
          >
            <SecurityLogo symbol={r.symbol} name={r.name} size="sm" />
            <span className="w-14 shrink-0 truncate text-xs font-semibold sm:text-sm">
              {r.label}
            </span>
            <span className="hidden min-w-0 flex-1 truncate text-xs text-muted sm:block">
              {r.name}
            </span>
            <span className="h-5 w-24 shrink-0 overflow-hidden rounded-sm bg-highlight sm:w-32">
              {/* A short's share is negative, and a negative CSS width is
                  invalid — the browser drops the rule and the block element
                  fills its whole track, drawing the short as the widest bar
                  on the chart. Clamp the bar; the label carries the sign. */}
              <span
                className={`block h-full rounded-sm ${
                  r.sharePct < 0 ? "bg-loss/70" : "bg-accent/70"
                }`}
                style={{
                  width: `${Math.min(
                    100,
                    (Math.abs(r.sharePct) / Math.abs(widest || 1)) * 100
                  )}%`,
                }}
              />
            </span>
            <span className="w-24 shrink-0 text-right text-xs tabular-nums sm:text-sm">
              <span className="block font-medium">
                {formatPercent(r.sharePct)}
              </span>
              <span className="block text-[10px] text-muted">
                {formatCurrencyWhole(r.marketValue)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
