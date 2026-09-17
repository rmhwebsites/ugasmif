// Live-portfolio analysis (SPEC 14). These numbers go on the performance and
// sector pages, where a wrong one is not obviously wrong to a reader.

import { describe, it, expect } from "vitest";
import {
  concentrationCurve,
  groupStats,
  maturityLadder,
  positionContributions,
  returnDistribution,
  sectorGains,
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

// ── The live-portfolio analysis added for the performance page ──────────────

function pos(
  symbol: string,
  marketValue: number,
  costBasis: number,
  opts: {
    sector?: string | null;
    weightPct?: number;
    maturity?: string | null;
    quantity?: number;
    coupon?: number | null;
    ytm?: number | null;
  } = {}
): HoldingValuation {
  return {
    holding: {
      id: `id-${symbol}`,
      symbol,
      name: `${symbol} Inc`,
      maturity_date: opts.maturity ?? null,
      quantity: opts.quantity ?? 0,
      coupon_rate: opts.coupon ?? null,
    },
    sectorName: opts.sector === undefined ? "Technology" : opts.sector,
    price: 10,
    priceSource: "live",
    markedAt: null,
    stale: false,
    accruedInterest: 0,
    marketValue,
    costBasis,
    unrealizedGain: marketValue - costBasis,
    weightPct: opts.weightPct ?? 0,
    dayChange: 1,
    dayChangePct: 0.1,
    ytm: opts.ytm ?? null,
    duration: null,
  } as unknown as HoldingValuation;
}

describe("returnDistribution", () => {
  it("sorts best to worst and counts each side", () => {
    const d = returnDistribution([
      pos("FLAT", 100, 100),
      pos("UP", 150, 100),
      pos("DOWN", 60, 100),
    ]);
    expect(d.positions.map((p) => p.label)).toEqual(["UP", "FLAT", "DOWN"]);
    expect(d.best?.label).toBe("UP");
    expect(d.worst?.label).toBe("DOWN");
    // A flat position is neither a winner nor a loser.
    expect(d.winners).toBe(1);
    expect(d.losers).toBe(1);
  });

  it("drops zero-cost lots rather than reporting an infinite return", () => {
    const d = returnDistribution([pos("GIFT", 500, 0), pos("REAL", 150, 100)]);
    expect(d.positions.map((p) => p.label)).toEqual(["REAL"]);
    expect(d.positions.every((p) => Number.isFinite(p.returnPct))).toBe(true);
  });

  it("takes the median of the middle pair when the count is even", () => {
    const d = returnDistribution([
      pos("A", 120, 100), // +20
      pos("B", 110, 100), // +10
      pos("C", 100, 100), // 0
      pos("D", 80, 100), // -20
    ]);
    expect(d.medianPct).toBeCloseTo(5, 6);
  });

  it("weights the overall return by cost, not by position count", () => {
    // A tiny doubling next to a large flat position is not a +50% fund.
    const d = returnDistribution([
      pos("SMALL", 2, 1),
      pos("BIG", 999, 999),
    ]);
    expect(d.weightedPct).toBeCloseTo((1 / 1000) * 100, 6);
  });

  it("has no best or worst when nothing has a cost basis", () => {
    const d = returnDistribution([pos("GIFT", 500, 0)]);
    expect(d.best).toBeNull();
    expect(d.worst).toBeNull();
    expect(d.medianPct).toBeNull();
    expect(d.weightedPct).toBeNull();
  });
});

describe("sectorGains", () => {
  it("ranks sectors by gain and measures share against gross movement", () => {
    const rows = sectorGains([
      pos("A", 200, 100, { sector: "Technology" }), // +100
      pos("B", 50, 100, { sector: "Energy" }), // -50
    ]);
    expect(rows.map((r) => r.sectorName)).toEqual(["Technology", "Energy"]);
    // Net is +50; measured against that, Technology would read 200%.
    expect(rows[0].shareOfGainPct).toBeCloseTo((100 / 150) * 100, 6);
    expect(rows[1].shareOfGainPct).toBeCloseTo((-50 / 150) * 100, 6);
  });

  it("groups holdings with no sector under one heading", () => {
    const rows = sectorGains([pos("A", 120, 100, { sector: null })]);
    expect(rows[0].sectorName).toBe("Unassigned");
  });

  it("reports no return for a sector with no cost basis", () => {
    const rows = sectorGains([pos("A", 120, 0, { sector: "Cash" })]);
    expect(rows[0].returnPct).toBeNull();
  });
});

describe("maturityLadder", () => {
  it("keeps empty years so a gap in the ladder stays visible", () => {
    const rows = maturityLadder([
      pos("T27", 100, 100, { maturity: "2027-05-15", quantity: 100 }),
      pos("T30", 100, 100, { maturity: "2030-01-31", quantity: 100 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      "2027",
      "2028",
      "2029",
      "2030",
    ]);
    expect(rows[1].positions).toBe(0);
    expect(rows[1].face).toBe(0);
  });

  it("reads the year off the date string, not a UTC-parsed Date", () => {
    // new Date("2031-01-01") is 2030 in any timezone west of Greenwich.
    const rows = maturityLadder([
      pos("T31", 100, 100, { maturity: "2031-01-01", quantity: 100 }),
    ]);
    expect(rows.map((r) => r.year)).toEqual([2031]);
  });

  it("weights coupon and yield by market value", () => {
    const rows = maturityLadder([
      pos("BIG", 300, 300, { maturity: "2029-06-30", coupon: 5, ytm: 4 }),
      pos("SMALL", 100, 100, { maturity: "2029-12-31", coupon: 1, ytm: 8 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].avgCouponPct).toBeCloseTo((300 * 5 + 100 * 1) / 400, 6);
    expect(rows[0].avgYtmPct).toBeCloseTo((300 * 4 + 100 * 8) / 400, 6);
  });

  it("ignores a missing coupon instead of counting it as zero", () => {
    const rows = maturityLadder([
      pos("HAS", 100, 100, { maturity: "2029-06-30", coupon: 6 }),
      pos("NONE", 300, 300, { maturity: "2029-06-30", coupon: null }),
    ]);
    expect(rows[0].avgCouponPct).toBeCloseTo(6, 6);
  });

  it("parks undated holdings in their own bucket at the end", () => {
    const rows = maturityLadder([
      pos("T27", 100, 100, { maturity: "2027-05-15" }),
      pos("ETF", 100, 100, { maturity: null }),
    ]);
    expect(rows[rows.length - 1].label).toBe("No maturity");
    expect(rows[rows.length - 1].year).toBeNull();
  });

  it("is empty for a book with nothing in it", () => {
    expect(maturityLadder([])).toEqual([]);
  });
});
