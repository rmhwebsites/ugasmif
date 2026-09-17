// Face value by maturity year — how a bond book is usually read (SPEC 14).
//
// Empty years are drawn as empty columns rather than closed up, because a gap
// in the ladder is a thing the PM needs to see. One hue, because the only
// thing colour encodes here is "this is the fund"; height carries the whole
// message.

import { formatCurrencyWhole, formatNumber } from "@/lib/format";
import type { MaturityBucket } from "@/lib/analysis";

export function MaturityLadder({ buckets }: { buckets: MaturityBucket[] }) {
  if (buckets.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted sm:px-6">
        No maturities to ladder yet.
      </p>
    );
  }

  const tallest = Math.max(...buckets.map((b) => b.face), 1);

  return (
    <div className="px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="flex h-44 items-end gap-1 border-b border-card-border">
        {buckets.map((b) => {
          const height = (b.face / tallest) * 100;
          return (
            <div
              key={b.label}
              title={
                b.positions === 0
                  ? `${b.label}: nothing matures`
                  : `${b.label} · ${formatCurrencyWhole(b.face)} face · ${
                      b.positions
                    } ${b.positions === 1 ? "position" : "positions"}${
                      b.avgYtmPct === null
                        ? ""
                        : ` · ${formatNumber(b.avgYtmPct, 2)}% YTM`
                    }`
              }
              className="group flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              <span className="mb-1 truncate text-center text-[10px] tabular-nums text-muted opacity-0 transition-opacity group-hover:opacity-100">
                {b.face > 0 ? formatCurrencyWhole(b.face) : ""}
              </span>
              <span
                className={`w-full rounded-t-sm transition-colors ${
                  b.face > 0
                    ? "bg-accent/75 group-hover:bg-accent"
                    : "bg-card-border"
                }`}
                // A year with nothing in it still gets a hairline, so the gap
                // reads as "checked, empty" rather than as a rendering slip.
                style={{ height: b.face > 0 ? `${height}%` : "3px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1">
        {buckets.map((b) => (
          <span
            key={b.label}
            className="min-w-0 flex-1 truncate pt-1 text-center text-[10px] tabular-nums text-muted"
          >
            {b.year === null ? "n/a" : `'${String(b.year).slice(2)}`}
          </span>
        ))}
      </div>
    </div>
  );
}
