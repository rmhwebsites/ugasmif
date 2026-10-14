// The holdings table's filters, in one place so the table on screen and its
// CSV export (/api/[fund]/holdings/export) always agree on what "these
// holdings" means. Pure functions, safe on the server and in the browser.

import type { HoldingValuation } from "@/types/domain";

/** The sector filter's value for holdings with no sector. */
export const UNASSIGNED_SECTOR = "unassigned";

export interface HoldingsFilter {
  /** Free text over symbol, name, CUSIP and issuer (?q=). */
  q?: string;
  /** A sector id, UNASSIGNED_SECTOR, or empty for every sector (?sector=). */
  sector?: string;
  /** An instrument type, or empty for every type (?type=). */
  type?: string;
  /** Only holdings whose price is stale (?price=stale). */
  staleOnly?: boolean;
}

/**
 * Every word typed has to appear somewhere in the holding's symbol, name,
 * CUSIP or issuer, so "treasury 2030" finds the 2030 Treasuries and "AGG"
 * finds the ETF.
 */
export function matchesQuery(v: HoldingValuation, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const h = v.holding;
  const hay = [h.symbol, h.name, h.cusip, h.isin, h.issuer]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

export function filterHoldings(
  holdings: HoldingValuation[],
  f: HoldingsFilter
): HoldingValuation[] {
  return holdings.filter((v) => {
    if (f.sector) {
      if (f.sector === UNASSIGNED_SECTOR) {
        if (v.holding.sector_id !== null) return false;
      } else if (v.holding.sector_id !== f.sector) {
        return false;
      }
    }
    if (f.type && v.holding.instrument_type !== f.type) return false;
    if (f.staleOnly && !v.stale) return false;
    if (f.q && !matchesQuery(v, f.q)) return false;
    return true;
  });
}

/** The export link for exactly the rows a filter shows. */
export function holdingsExportHref(fund: string, f: HoldingsFilter): string {
  const params = new URLSearchParams();
  if (f.sector) params.set("sector", f.sector);
  if (f.type) params.set("type", f.type);
  if (f.staleOnly) params.set("price", "stale");
  const q = f.q?.trim();
  if (q) params.set("q", q);
  const qs = params.toString();
  return `/api/${fund}/holdings/export${qs ? `?${qs}` : ""}`;
}
