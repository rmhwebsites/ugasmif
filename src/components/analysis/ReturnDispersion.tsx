// How wide the book's returns are spread (SPEC 14).
//
// One bar per position, best at the top, growing from a centre line: winners
// right, losers left. A fund can be up overall on the back of two names while
// most of the book is flat or down, and a single headline return hides that
// completely — the shape is the point.
//
// Green and red are hard to tell apart for a deuteranope (ΔE 7.4), so colour
// never carries the meaning on its own: which side of the centre line a bar
// sits on says it, and every row is labelled with its signed return.

import Link from "next/link";
import { formatCurrencyWhole, formatSignedPercent } from "@/lib/format";
import type { PositionReturn } from "@/lib/analysis";

export function ReturnDispersion({
  positions,
  fund,
  limit = 30,
}: {
  positions: PositionReturn[];
  fund: string;
  limit?: number;
}) {
  if (positions.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted sm:px-6">
        No positions with a cost basis yet.
      </p>
    );
  }

  // Both halves share one scale, so a −30% bar is visibly three times a −10%.
  const widest = Math.max(...positions.map((p) => Math.abs(p.returnPct)), 1);
  // Keep the column split even, so the left column is never one row longer
  // than the right for no reason.
  const capped = positions.slice(0, limit);
  const shown =
    capped.length === positions.length || capped.length % 2 === 0
      ? capped
      : capped.slice(0, capped.length - 1);
  const hidden = positions.length - shown.length;

  return (
    <div>
      {/* Two columns on a wide screen: 24 names in one tall column is a
          lot of scrolling for a list whose whole point is the shape. */}
      <ul className="grid gap-x-6 lg:grid-cols-2">
        {shown.map((p) => {
          const positive = p.returnPct >= 0;
          const width = (Math.abs(p.returnPct) / widest) * 100;
          return (
            <li key={p.id} className="border-b border-card-border/40">
              <Link
                href={`/${fund}/holdings/${p.id}`}
                title={`${p.label} · ${formatSignedPercent(
                  p.returnPct
                )} on cost · ${formatCurrencyWhole(p.unrealizedGain)} unrealized`}
                className="flex items-center gap-2 px-4 py-1.5 transition-colors hover:bg-highlight sm:gap-3 sm:px-6"
              >
                <span
                  title={p.label}
                  className="w-24 shrink-0 truncate text-xs font-semibold sm:w-32"
                >
                  {p.label}
                </span>

                <span className="flex min-w-0 flex-1 items-center">
                  <span className="flex h-3 flex-1 justify-end">
                    {!positive && (
                      <span
                        className="h-full rounded-l-sm bg-loss/70"
                        style={{ width: `${width}%` }}
                      />
                    )}
                  </span>
                  <span className="h-3 w-px shrink-0 bg-card-border" />
                  <span className="flex h-3 flex-1">
                    {positive && (
                      <span
                        className="h-full rounded-r-sm bg-gain/70"
                        style={{ width: `${width}%` }}
                      />
                    )}
                  </span>
                </span>

                <span
                  className={`w-16 shrink-0 text-right text-xs font-medium tabular-nums ${
                    positive ? "text-gain" : "text-loss"
                  }`}
                >
                  {formatSignedPercent(p.returnPct)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {hidden > 0 && (
        <p className="px-4 py-2 text-center text-xs text-muted sm:px-6">
          {hidden} smaller {hidden === 1 ? "position" : "positions"} not shown
        </p>
      )}
    </div>
  );
}
