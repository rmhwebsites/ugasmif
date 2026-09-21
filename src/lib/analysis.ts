// Portfolio analysis that works from the LIVE valuation, with no snapshot
// history behind it (SPEC 14).
//
// The performance page's returns, drawdown and attribution all chain off
// fund_snapshots, so they say nothing until the nightly cron has run twice.
// Everything here is computed from positions the fund holds right now, so it
// is useful on day one and stays useful afterwards.

import type { HoldingValuation } from "@/types/domain";

export interface PositionContribution {
  holdingId: string;
  label: string;
  name: string;
  symbol: string | null;
  /** Unrealized gain in dollars — what the position has made or lost. */
  gain: number;
  costBasis: number;
  marketValue: number;
  /** gain / costBasis, in percent. Null when there is no cost to measure. */
  returnPct: number | null;
  /** Share of the fund's TOTAL unrealized gain, in percent. Null when the
   *  fund's gains and losses net to roughly zero and the share is meaningless. */
  shareOfGainPct: number | null;
  weightPct: number;
}

/**
 * Every position's contribution to the fund's unrealized gain, biggest
 * absolute mover first.
 *
 * `shareOfGainPct` is deliberately measured against the sum of the ABSOLUTE
 * gains and losses rather than the net. Netting is what makes these numbers
 * lie: a fund up $50k on one holding and down $49k on another has a $1k net,
 * against which the winner is "5000% of the gain", which tells you nothing.
 */
export function positionContributions(
  holdings: HoldingValuation[]
): PositionContribution[] {
  const grossMovement = holdings.reduce(
    (sum, h) => sum + Math.abs(h.unrealizedGain),
    0
  );

  return holdings
    .map((h) => ({
      holdingId: h.holding.id,
      label: h.holding.symbol ?? h.holding.name,
      name: h.holding.name,
      symbol: h.holding.symbol,
      gain: h.unrealizedGain,
      costBasis: h.costBasis,
      marketValue: h.marketValue,
      returnPct:
        h.costBasis > 0 ? (h.unrealizedGain / h.costBasis) * 100 : null,
      shareOfGainPct:
        grossMovement > 0 ? (h.unrealizedGain / grossMovement) * 100 : null,
      weightPct: h.weightPct,
    }))
    .sort((a, b) => Math.abs(b.gain) - Math.abs(a.gain));
}

export interface ConcentrationPoint {
  /** Number of positions included. */
  n: number;
  /** Their combined share of the fund, in percent. */
  cumulativeWeightPct: number;
}

/**
 * Cumulative weight of the largest N positions, for the concentration curve.
 * A steep start means the fund rides on a handful of names.
 */
export function concentrationCurve(
  holdings: HoldingValuation[],
  upTo = 20
): ConcentrationPoint[] {
  const sorted = [...holdings]
    .map((h) => h.weightPct)
    .sort((a, b) => b - a);

  const out: ConcentrationPoint[] = [];
  let running = 0;
  for (let i = 0; i < Math.min(upTo, sorted.length); i++) {
    running += sorted[i];
    out.push({ n: i + 1, cumulativeWeightPct: running });
  }
  return out;
}

export interface GroupStats {
  marketValue: number;
  costBasis: number;
  unrealizedGain: number;
  /** unrealizedGain / costBasis, in percent. Null with no cost basis. */
  returnPct: number | null;
  dayChange: number | null;
  positions: number;
  /** Largest single position's share OF THIS GROUP, in percent. */
  topWeightPct: number | null;
  /** The name of that largest position. */
  topLabel: string | null;
}

/** Aggregates a set of positions — a sector, an instrument type, the fund. */
export function groupStats(holdings: HoldingValuation[]): GroupStats {
  if (holdings.length === 0) {
    return {
      marketValue: 0,
      costBasis: 0,
      unrealizedGain: 0,
      returnPct: null,
      dayChange: null,
      positions: 0,
      topWeightPct: null,
      topLabel: null,
    };
  }

  const marketValue = holdings.reduce((s, h) => s + h.marketValue, 0);
  const costBasis = holdings.reduce((s, h) => s + h.costBasis, 0);
  const unrealizedGain = holdings.reduce((s, h) => s + h.unrealizedGain, 0);

  // A day change is only a number if something priced today. Summing over
  // holdings whose quote failed would quietly understate the move, so a group
  // with no priced holdings reports null rather than zero.
  const priced = holdings.filter((h) => h.dayChange !== null);
  const dayChange =
    priced.length > 0
      ? priced.reduce((s, h) => s + (h.dayChange ?? 0), 0)
      : null;

  const largest = [...holdings].sort((a, b) => b.marketValue - a.marketValue)[0];

  return {
    marketValue,
    costBasis,
    unrealizedGain,
    returnPct: costBasis > 0 ? (unrealizedGain / costBasis) * 100 : null,
    dayChange,
    positions: holdings.length,
    topWeightPct:
      marketValue > 0 ? (largest.marketValue / marketValue) * 100 : null,
    topLabel: largest.holding.symbol ?? largest.holding.name,
  };
}

/** Each position's share OF ITS GROUP, largest first. */
export function weightsWithinGroup(
  holdings: HoldingValuation[]
): { holdingId: string; label: string; name: string; symbol: string | null; marketValue: number; sharePct: number }[] {
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);
  return [...holdings]
    .sort((a, b) => b.marketValue - a.marketValue)
    .map((h) => ({
      holdingId: h.holding.id,
      label: h.holding.symbol ?? h.holding.name,
      name: h.holding.name,
      symbol: h.holding.symbol,
      marketValue: h.marketValue,
      sharePct: total > 0 ? (h.marketValue / total) * 100 : 0,
    }));
}

// ── Dispersion ──────────────────────────────────────────────────────────────

export interface PositionReturn {
  id: string;
  label: string;
  sectorName: string | null;
  returnPct: number;
  unrealizedGain: number;
  weightPct: number;
}

export interface ReturnDistribution {
  /** Every priced position, best return first. */
  positions: PositionReturn[];
  winners: number;
  losers: number;
  best: PositionReturn | null;
  worst: PositionReturn | null;
  /** Median return, which says more than the mean when one name dominates. */
  medianPct: number | null;
  /** Value-weighted return on cost across the positions below. */
  weightedPct: number | null;
}

/**
 * Unrealized return per position, for showing how wide the spread is.
 *
 * A fund can be up overall on one holding while most of the book is down; an
 * aggregate number hides that, and the shape of the distribution is the thing
 * worth looking at.
 *
 * Positions with no cost basis are dropped rather than counted flat: a
 * donated or zero-cost lot has no return to speak of, and dividing by it
 * gives an infinity that would swamp the axis.
 *
 * A short has a NEGATIVE cost basis, because the fund received the cash
 * rather than paying it. Dividing by the signed figure would flip the sign
 * of a short's return, so the denominator is the absolute exposure — a short
 * that gains money reads positive, which is what happened.
 */
export function returnDistribution(
  holdings: HoldingValuation[]
): ReturnDistribution {
  const positions: PositionReturn[] = holdings
    .filter((h) => h.costBasis !== 0)
    .map((h) => ({
      id: h.holding.id,
      label: h.holding.symbol ?? h.holding.name ?? "—",
      sectorName: h.sectorName,
      returnPct: (h.unrealizedGain / Math.abs(h.costBasis)) * 100,
      unrealizedGain: h.unrealizedGain,
      weightPct: h.weightPct,
    }))
    .sort((a, b) => b.returnPct - a.returnPct);

  if (positions.length === 0) {
    return {
      positions,
      winners: 0,
      losers: 0,
      best: null,
      worst: null,
      medianPct: null,
      weightedPct: null,
    };
  }

  const mid = Math.floor(positions.length / 2);
  const medianPct =
    positions.length % 2 === 1
      ? positions[mid].returnPct
      : (positions[mid - 1].returnPct + positions[mid].returnPct) / 2;

  // Capital at risk, so a short's exposure adds to the denominator instead of
  // netting against the longs.
  const priced = holdings.filter((h) => h.costBasis !== 0);
  const cost = priced.reduce((s, h) => s + Math.abs(h.costBasis), 0);
  const gain = priced.reduce((s, h) => s + h.unrealizedGain, 0);

  return {
    positions,
    winners: positions.filter((p) => p.returnPct > 0).length,
    losers: positions.filter((p) => p.returnPct < 0).length,
    best: positions[0],
    worst: positions[positions.length - 1],
    medianPct,
    weightedPct: cost > 0 ? (gain / cost) * 100 : null,
  };
}

// ── Where the gain came from ────────────────────────────────────────────────

export interface SectorGain {
  sectorName: string;
  marketValue: number;
  costBasis: number;
  unrealizedGain: number;
  returnPct: number | null;
  weightPct: number;
  /** Share of the fund's gross movement, so winners and losers both read. */
  shareOfGainPct: number | null;
  positions: number;
}

/**
 * Unrealized gain grouped by sector: which parts of the book made the money,
 * as opposed to which parts hold the money.
 *
 * Share is measured against gross movement (the sum of absolute gains and
 * losses) rather than the net. Against a small net, one sector's share can run
 * to several hundred percent, which is arithmetically true and useless on a
 * chart.
 */
export function sectorGains(holdings: HoldingValuation[]): SectorGain[] {
  const groups = new Map<string, HoldingValuation[]>();
  for (const h of holdings) {
    const key = h.sectorName ?? "Unassigned";
    const list = groups.get(key);
    if (list) list.push(h);
    else groups.set(key, [h]);
  }

  const gross = holdings.reduce((s, h) => s + Math.abs(h.unrealizedGain), 0);
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);

  return [...groups.entries()]
    .map(([sectorName, rows]) => {
      const marketValue = rows.reduce((s, h) => s + h.marketValue, 0);
      const costBasis = rows.reduce((s, h) => s + h.costBasis, 0);
      const unrealizedGain = rows.reduce((s, h) => s + h.unrealizedGain, 0);
      return {
        sectorName,
        marketValue,
        costBasis,
        unrealizedGain,
        returnPct: costBasis > 0 ? (unrealizedGain / costBasis) * 100 : null,
        weightPct: total > 0 ? (marketValue / total) * 100 : 0,
        shareOfGainPct: gross > 0 ? (unrealizedGain / gross) * 100 : null,
        positions: rows.length,
      };
    })
    .sort((a, b) => b.unrealizedGain - a.unrealizedGain);
}

// ── Fixed income: when the money comes back ─────────────────────────────────

export interface MaturityBucket {
  /** Calendar year, or null for the holdings with no maturity date. */
  year: number | null;
  label: string;
  marketValue: number;
  /** Face value, which is what actually matures. */
  face: number;
  weightPct: number;
  /** Market-value weighted, null when nothing in the bucket carries one. */
  avgCouponPct: number | null;
  avgYtmPct: number | null;
  positions: number;
}

function weightedAverage(
  rows: { weight: number; value: number | null }[]
): number | null {
  const usable = rows.filter((r) => r.value !== null && r.weight > 0);
  const weight = usable.reduce((s, r) => s + r.weight, 0);
  if (weight === 0) return null;
  return usable.reduce((s, r) => s + r.weight * (r.value ?? 0), 0) / weight;
}

/**
 * Face value by maturity year — the ladder a bond book is usually read as.
 *
 * Years with nothing in them are still returned, so the gaps in the ladder are
 * visible rather than closed up. Anything without a maturity date (a bond fund
 * ETF, a sweep) lands in its own bucket at the end rather than being dropped.
 */
export function maturityLadder(
  holdings: HoldingValuation[]
): MaturityBucket[] {
  const dated = holdings.filter((h) => h.holding.maturity_date !== null);
  const undated = holdings.filter((h) => h.holding.maturity_date === null);
  const total = holdings.reduce((s, h) => s + h.marketValue, 0);

  const byYear = new Map<number, HoldingValuation[]>();
  for (const h of dated) {
    // Parse the year off the date string: `new Date("2031-05-15")` is UTC
    // midnight, which is the previous year west of Greenwich.
    const year = Number((h.holding.maturity_date as string).slice(0, 4));
    if (!Number.isFinite(year)) continue;
    const list = byYear.get(year);
    if (list) list.push(h);
    else byYear.set(year, [h]);
  }

  const bucket = (
    year: number | null,
    label: string,
    rows: HoldingValuation[]
  ): MaturityBucket => {
    const marketValue = rows.reduce((s, h) => s + h.marketValue, 0);
    return {
      year,
      label,
      marketValue,
      // Only instruments that HAVE a face have one: quantity is face dollars
      // on a bond but a share count on a fund, and adding the two gives a
      // number in no unit at all.
      face: rows.reduce(
        (s, h) => s + (h.holding.maturity_date ? Number(h.holding.quantity) : 0),
        0
      ),
      weightPct: total > 0 ? (marketValue / total) * 100 : 0,
      avgCouponPct: weightedAverage(
        rows.map((h) => ({
          weight: h.marketValue,
          value:
            h.holding.coupon_rate === null ? null : Number(h.holding.coupon_rate),
        }))
      ),
      avgYtmPct: weightedAverage(
        rows.map((h) => ({ weight: h.marketValue, value: h.ytm }))
      ),
      positions: rows.length,
    };
  };

  const years = [...byYear.keys()].sort((a, b) => a - b);
  const buckets: MaturityBucket[] = [];
  if (years.length > 0) {
    // Fill the gaps so a hole in the ladder looks like a hole.
    for (let y = years[0]; y <= years[years.length - 1]; y += 1) {
      buckets.push(bucket(y, String(y), byYear.get(y) ?? []));
    }
  }
  if (undated.length > 0) {
    buckets.push(bucket(null, "No maturity", undated));
  }
  return buckets;
}
