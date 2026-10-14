// Price source badge (SPEC 11.2 / 13.2 / 13.3): says exactly where a
// holding's price came from: live quote, Treasury par-curve approximation,
// a manual mark ("marked 09/12"), a curve-drifted estimate ("est. 09/12"),
// or par for money-market sweeps. A stale price gets a "stale" badge, the
// same word Manage holdings uses for an old mark. Pure presentational
// component, safe in server and client trees.
//
// The tooltips say why, never where to go: the pages decide who gets a link
// to fix it (see stalePriceReason).

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/format";
import type { PriceSource } from "@/types/domain";

const CURVE_TOOLTIP =
  "Priced off the Treasury par yield curve: an approximation of the market quote, usually within a few cents.";

const ESTIMATE_TOOLTIP =
  "Estimated from the last manual mark, moved with Treasury yields at the holding's benchmark tenor since the mark date. Not a quote.";

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

/**
 * Why a price is stale, in one sentence a member can read. Used for the
 * badge's tooltip and, on a holding's page, as visible text under the price.
 */
export function stalePriceReason({
  source,
  markedAt,
  price,
  staleMarkDays,
}: {
  source: PriceSource;
  markedAt: string | null;
  price: number | null;
  /** The fund's limit on mark age, when the caller knows it. */
  staleMarkDays?: number;
}): string {
  switch (source) {
    case "live":
      return price === null
        ? "No live quote came through, so the value shown is the cost basis."
        : "The live quote didn't refresh, so this is the last price saved.";
    case "curve":
      return "No Treasury curve is loaded yet, so the value shown is cost plus accrued interest.";
    case "mark":
    case "estimate":
      if (!markedAt) {
        return "This bond hasn't been marked yet, so the value shown is cost plus accrued interest.";
      }
      return staleMarkDays
        ? `The last mark is from ${formatDate(markedAt)}, older than the fund's ${staleMarkDays}-day limit.`
        : `The last mark is from ${formatDate(markedAt)}, older than the fund's limit for marks.`;
    case "par":
      return "This price is out of date.";
  }
}

export function PriceSourceBadge({
  source,
  markedAt = null,
  stale = false,
  price = null,
}: {
  source: PriceSource;
  /** For mark/estimate sources: timestamp of the underlying mark. */
  markedAt?: string | null;
  stale?: boolean;
  /** The price shown, so the stale tooltip can say when it is cost. */
  price?: number | null;
}) {
  const staleBadge = stale ? (
    <Badge
      tone="warn"
      title={`Stale price. ${stalePriceReason({ source, markedAt, price })}`}
    >
      stale
    </Badge>
  ) : null;

  // A stale live quote is just "stale": calling it "live" would lie.
  if (source === "live" && stale) return staleBadge;

  let main: ReactNode;
  switch (source) {
    case "live":
      main = (
        <Badge tone="gain" title="Live quote from Yahoo Finance.">
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
          title="No mark entered yet, so the value shown is cost plus accrued interest."
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

  // "not marked" already says it; a second "stale" beside it is noise.
  if (!staleBadge || (source === "mark" && !markedAt)) return <>{main}</>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      {main}
      {staleBadge}
    </span>
  );
}
