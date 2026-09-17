// Live-portfolio analysis (SPEC 14). These numbers go on the performance and
// sector pages, where a wrong one is not obviously wrong to a reader.

import { describe, it, expect } from "vitest";
import {
  concentrationCurve,
  groupStats,
  positionContributions,
  weightsWithinGroup,
} from "@/lib/analysis";
import type { HoldingValuation } from "@/types/domain";

function h(
  symbol: string,
  marketValue: number,
  costBasis: number,
  opts: { dayChange?: number | null; weightPct?: number } = {}
): HoldingValuation {
  return {
    holding: { id: `id-${symbol}`, symbol, name: `${symbol} Inc` },
    sectorName: "Technology",
    price: 10,
    priceSource: "live",
    markedAt: null,
    stale: false,
    accruedInterest: 0,
    marketValue,
    costBasis,
    unrealizedGain: marketValue - costBasis,
    weightPct: opts.weightPct ?? 0,
    dayChange: opts.dayChange === undefined ? 1 : opts.dayChange,
    dayChangePct: 0.1,
    ytm: null,
    duration: null,
  } as unknown as HoldingValuation;
}

describe("positionContributions", () => {
  it("ranks by absolute move, so big losers surface too", () => {
    const rows = positionContributions([
      h("SMALL", 1_100, 1_000), // +100
      h("BIGLOSS", 5_000, 9_000), // -4000
      h("BIGWIN", 8_000, 5_000), // +3000
    ]);
    expect(rows.map((r) => r.label)).toEqual(["BIGLOSS", "BIGWIN", "SMALL"]);
  });

  it("measures share against gross movement, not the net", () => {
    // The netting trap: up 50k on one, down 49k on another. Net is 1k, and
    // against that the winner is "5000% of the gain", which is nonsense.
    const rows = positionContributions([
      h("WIN", 150_000, 100_000), // +50,000
      h("LOSE", 51_000, 100_000), // -49,000
    ]);
    const win = rows.find((r) => r.label === "WIN");
    expect(win?.shareOfGainPct).toBeCloseTo((50_000 / 99_000) * 100, 6);
    expect(win!.shareOfGainPct!).toBeLessThan(100);
  });

  it("returns a null share when nothing has moved", () => {
    const rows = positionContributions([h("FLAT", 1_000, 1_000)]);
    expect(rows[0].shareOfGainPct).toBeNull();
  });

  it("returns a null return when there is no cost basis", () => {
    expect(positionContributions([h("GIFT", 500, 0)])[0].returnPct).toBeNull();
  });

  it("computes return off cost, not market value", () => {
    const row = positionContributions([h("X", 1_500, 1_000)])[0];
    expect(row.returnPct).toBeCloseTo(50, 9);
  });
});

describe("concentrationCurve", () => {
  it("accumulates the largest weights in order", () => {
    const curve = concentrationCurve([
      h("A", 0, 0, { weightPct: 10 }),
      h("B", 0, 0, { weightPct: 30 }),
      h("C", 0, 0, { weightPct: 20 }),
    ]);
    expect(curve.map((p) => [p.n, p.cumulativeWeightPct])).toEqual([
      [1, 30],
      [2, 50],
      [3, 60],
    ]);
  });

  it("stops at upTo, and at the number of holdings", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      h(`S${i}`, 0, 0, { weightPct: 1 })
    );
    expect(concentrationCurve(many, 20)).toHaveLength(20);
    expect(concentrationCurve(many.slice(0, 3), 20)).toHaveLength(3);
  });

  it("handles an empty portfolio", () => {
    expect(concentrationCurve([])).toEqual([]);
  });
});

describe("groupStats", () => {
  it("aggregates value, cost and gain", () => {
    const s = groupStats([h("A", 1_500, 1_000), h("B", 500, 1_000)]);
    expect(s.marketValue).toBe(2_000);
    expect(s.costBasis).toBe(2_000);
    expect(s.unrealizedGain).toBe(0);
    expect(s.returnPct).toBe(0);
    expect(s.positions).toBe(2);
  });

  it("names the largest position and its share of the group", () => {
    const s = groupStats([h("BIG", 7_500, 1), h("SMALL", 2_500, 1)]);
    expect(s.topLabel).toBe("BIG");
    expect(s.topWeightPct).toBeCloseTo(75, 9);
  });

  it("reports a null day change when nothing priced today", () => {
    // Summing over unpriced holdings would quietly understate the move.
    const s = groupStats([
      h("A", 100, 100, { dayChange: null }),
      h("B", 100, 100, { dayChange: null }),
    ]);
    expect(s.dayChange).toBeNull();
  });

  it("sums only the priced holdings when some are stale", () => {
    const s = groupStats([
      h("A", 100, 100, { dayChange: 12 }),
      h("B", 100, 100, { dayChange: null }),
    ]);
    expect(s.dayChange).toBe(12);
  });

  it("returns zeros for an empty group rather than NaN", () => {
    const s = groupStats([]);
    expect(s).toMatchObject({
      marketValue: 0,
      positions: 0,
      returnPct: null,
      topLabel: null,
    });
  });
});

describe("weightsWithinGroup", () => {
  it("shares sum to 100 within the group, not the fund", () => {
    const rows = weightsWithinGroup([h("A", 750, 1), h("B", 250, 1)]);
    expect(rows.map((r) => r.label)).toEqual(["A", "B"]);
    expect(rows[0].sharePct).toBeCloseTo(75, 9);
    expect(rows.reduce((s, r) => s + r.sharePct, 0)).toBeCloseTo(100, 9);
  });

  it("does not divide by zero on a worthless group", () => {
    expect(weightsWithinGroup([h("A", 0, 0)])[0].sharePct).toBe(0);
  });
});
