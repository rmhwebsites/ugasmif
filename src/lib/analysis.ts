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
