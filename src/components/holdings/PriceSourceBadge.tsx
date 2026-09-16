// Price source badge (SPEC 11.2 / 13.2 / 13.3): says exactly where a
// holding's price came from — live quote, Treasury par-curve approximation,
// a manual mark ("marked 09/12"), a curve-drifted estimate ("est. 09/12"),
// or par for money-market sweeps. Stale data gets a "delayed" badge. Pure
// presentational component, safe in server and client trees.

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import type { PriceSource } from "@/types/domain";

const CURVE_TOOLTIP =
  "Priced off the Treasury par yield curve — an approximation of the market quote, usually within a few cents. The PM can override it with a manual mark.";

const ESTIMATE_TOOLTIP =
  "Estimated from the last manual mark, drifted with the Treasury par yield move at the holding's benchmark tenor since the mark date. Not a quote.";

const DELAYED_TOOLTIP =
  "Data is delayed — the live quote is unavailable or the latest mark is older than the fund's staleness threshold.";

/** "09/12" in Eastern time for the mark-date badges. */
function mmdd(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  });
}

export function PriceSourceBadge({
  source,
  markedAt = null,
  stale = false,
}: {
  source: PriceSource;
  /** For mark/estimate sources: timestamp of the underlying mark. */
  markedAt?: string | null;
  stale?: boolean;
}) {
  const delayed = stale ? (
    <Badge tone="warn" title={DELAYED_TOOLTIP}>
      delayed
    </Badge>
  ) : null;

  // A stale live quote is just "delayed" — calling it "live" would lie.
  if (source === "live" && stale) return delayed;

  let main: ReactNode;
  switch (source) {
    case "live":
      main = (
        <Badge tone="gain" title="Live Yahoo Finance quote.">
          <span className="h-1.5 w-1.5 rounded-full bg-gain" aria-hidden="true" />
          live
        </Badge>
      );
      break;
    case "curve":
      main = (
        <Badge tone="info" title={CURVE_TOOLTIP}>
          curve
        </Badge>
      );
      break;
    case "mark":
      main = markedAt ? (
        <Badge tone="neutral" title={`Manual mark entered ${formatDate(markedAt)}.`}>
          marked {mmdd(markedAt)}
        </Badge>
      ) : (
        <Badge
          tone="warn"
          title="No mark entered yet — showing cost basis. The PM can add a mark under Admin → Holdings."
        >
          not marked
        </Badge>
      );
      break;
    case "estimate":
      main = (
        <Badge tone="warn" title={ESTIMATE_TOOLTIP}>
          est. {markedAt ? mmdd(markedAt) : "—"}
        </Badge>
      );
      break;
    case "par":
      main = (
        <Badge tone="neutral" title="Money market sweep held at $1.00 per unit.">
          par
        </Badge>
      );
      break;
  }

  if (!delayed) return <>{main}</>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {main}
      {delayed}
    </span>
  );
}
