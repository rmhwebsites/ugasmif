// Hand-computed unit tests for the bond math libs (SPEC 13.2-13.3 acceptance).
// Pure functions only — synthetic curves, no network.

import { describe, it, expect } from "vitest";
import type { BondMark, Holding, TreasuryCurvePoint } from "@/types/domain";
import { accruedInterest, couponSchedule, nextCouponDates } from "@/lib/bonds/accrued";
import { interpolateYield, priceTreasury } from "@/lib/bonds/treasury";
import { estimateBondPrice } from "@/lib/bonds/estimate";

function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: "h1",
    fund_id: "f1",
    sector_id: null,
    instrument_type: "corporate",
    symbol: null,
    cusip: null,
    isin: null,
    name: "Test 4% Corporate",
    issuer: null,
    quantity: 100_000,
    avg_cost: 100,
    coupon_rate: 4,
    maturity_date: "2030-01-01",
    issue_date: null,
    first_coupon_date: null,
    payment_frequency: 2,
    day_count: "30/360",
    rating: null,
    duration: null,
    ytm: null,
    pricing_method: "manual",
    benchmark_tenor: null,
    is_active: true,
    opened_on: null,
    closed_on: null,
    notes: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ALL_TENORS = [1, 2, 3, 4, 6, 12, 24, 36, 60, 84, 120, 240, 360];

function flatCurve(yieldPct: number, date: string): TreasuryCurvePoint[] {
  return ALL_TENORS.map((tenor_months) => ({
    curve_date: date,
    tenor_months,
    yield_pct: yieldPct,
  }));
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d));
}

describe("accrued interest (day counts)", () => {
  // Coupon cycle derived from maturity 2030-01-01 semiannually: Jan 1 / Jul 1.
  // As of 2026-04-01 we are 90 30/360-days into the 180-day Jan-Jul period.
  it("30/360: 4% semiannual, 90 days into a 180-day period, $100,000 face = $1,000", () => {
    const h = makeHolding();
    expect(accruedInterest(h, utc(2026, 4, 1))).toBeCloseTo(1000, 6);
  });

  it("derives coupon dates by stepping back from maturity", () => {
    const { prev, next, daysInPeriod } = nextCouponDates(makeHolding(), utc(2026, 4, 1));
    expect(prev.toISOString().slice(0, 10)).toBe("2026-01-01");
    expect(next.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(daysInPeriod).toBe(181); // actual days Jan 1 -> Jul 1 2026
  });

  it("ACT/ACT uses actual days elapsed over actual days in period", () => {
    const h = makeHolding({ day_count: "ACT/ACT", instrument_type: "treasury" });
    // 90 actual days (Jan 1 -> Apr 1) of a 181-day period: 2000 * 90/181
    expect(accruedInterest(h, utc(2026, 4, 1))).toBeCloseTo((2000 * 90) / 181, 6);
  });

  it("ACT/360 accrues actual days over a 360-day year", () => {
    const h = makeHolding({ day_count: "ACT/360", instrument_type: "money_market" });
    // face * coupon/freq * actualDays / (360/freq) = 100000 * 0.04 * 90/360
    expect(accruedInterest(h, utc(2026, 4, 1))).toBeCloseTo(1000, 6);
  });

  it("is zero on a coupon date and after maturity", () => {
    const h = makeHolding();
    expect(accruedInterest(h, utc(2026, 1, 1))).toBe(0);
    expect(accruedInterest(h, utc(2031, 1, 1))).toBe(0);
  });

  it("couponSchedule lists remaining coupons plus principal at maturity", () => {
    const h = makeHolding({ maturity_date: "2027-01-01" });
    const schedule = couponSchedule(h, utc(2026, 4, 1));
    expect(schedule).toHaveLength(2);
    expect(schedule[0].date.toISOString().slice(0, 10)).toBe("2026-07-01");
    expect(schedule[0].amount).toBeCloseTo(2000, 6);
    expect(schedule[1].date.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(schedule[1].amount).toBeCloseTo(102_000, 6);
  });
});

describe("priceTreasury", () => {
  const treasury = makeHolding({
    instrument_type: "treasury",
    name: "T 4 03/01/31",
    day_count: "ACT/ACT",
    pricing_method: "treasury_curve",
    maturity_date: "2031-03-01",
    coupon_rate: 4,
  });

  it("prices a 4% coupon at ~100.00 off a flat 4% curve (within $1 per 100)", () => {
    const priced = priceTreasury(treasury, flatCurve(4, "2026-09-15"), utc(2026, 9, 15));
    expect(priced).not.toBeNull();
    if (!priced) return;
    expect(Math.abs(priced.cleanPrice - 100)).toBeLessThan(1); // spec acceptance
    expect(priced.ytm).toBeCloseTo(4, 6);
    // ~4.5y par bond: modified duration should land near 4 years.
    expect(priced.duration).toBeGreaterThan(3.5);
    expect(priced.duration).toBeLessThan(4.6);
    // 14 actual days accrued of a 181-day period on $100k face at 4%/2.
    expect(priced.accrued).toBeCloseTo((2000 * 14) / 181, 4);
  });

  it("returns null for a matured bond or an empty curve", () => {
    expect(priceTreasury(treasury, flatCurve(4, "2032-01-05"), utc(2032, 1, 5))).toBeNull();
    expect(priceTreasury(treasury, [], utc(2026, 9, 15))).toBeNull();
  });
});

describe("interpolateYield", () => {
  const curve: TreasuryCurvePoint[] = [
    { curve_date: "2026-09-15", tenor_months: 24, yield_pct: 4.0 },
    { curve_date: "2026-09-15", tenor_months: 60, yield_pct: 4.6 },
    { curve_date: "2026-09-15", tenor_months: 120, yield_pct: 5.0 },
  ];

  it("is linear between surrounding tenors", () => {
    // 3y = 36 months, a third of the way from 24m (4.0) to 60m (4.6)
    expect(interpolateYield(curve, 3)).toBeCloseTo(4.2, 10);
    // 7y = 84 months, 40% of the way from 60m (4.6) to 120m (5.0)
    expect(interpolateYield(curve, 7)).toBeCloseTo(4.76, 10);
  });

  it("returns exact values at knot tenors", () => {
    expect(interpolateYield(curve, 2)).toBeCloseTo(4.0, 10);
    expect(interpolateYield(curve, 5)).toBeCloseTo(4.6, 10);
  });

  it("clamps at the ends and returns null for an empty curve", () => {
    expect(interpolateYield(curve, 0.5)).toBeCloseTo(4.0, 10);
    expect(interpolateYield(curve, 30)).toBeCloseTo(5.0, 10);
    expect(interpolateYield([], 5)).toBeNull();
  });
});

describe("estimateBondPrice", () => {
  const mark: BondMark = {
    id: "m1",
    holding_id: "h1",
    clean_price: 98.5,
    ytm: 5.2,
    duration: 6,
    source: "bloomberg",
    marked_by: "u1",
    marked_at: "2026-09-01T15:00:00Z",
    notes: null,
  };
  const holding = makeHolding({ benchmark_tenor: 10, duration: 5 });

  it("applies price = mark * (1 - duration * delta_yield): +25bp, D=6 -> 97.0225", () => {
    const est = estimateBondPrice(
      holding,
      mark,
      flatCurve(4.0, "2026-09-01"),
      flatCurve(4.25, "2026-09-15")
    );
    expect(est.cleanPrice).toBeCloseTo(97.0225, 6); // 98.50 * (1 - 6 * 0.0025)
    expect(est.source).toBe("estimate");
    expect(est.markedAt).toBe(mark.marked_at);
    expect(est.duration).toBe(6); // mark duration wins over holding duration
  });

  it("falls back to the holding's duration when the mark has none", () => {
    const est = estimateBondPrice(
      holding,
      { ...mark, duration: null },
      flatCurve(4.0, "2026-09-01"),
      flatCurve(4.25, "2026-09-15")
    );
    expect(est.cleanPrice).toBeCloseTo(98.5 * (1 - 5 * 0.0025), 6);
    expect(est.duration).toBe(5);
  });

  it("returns the raw mark when curve data is missing", () => {
    const est = estimateBondPrice(holding, mark, null, null);
    expect(est.cleanPrice).toBeCloseTo(98.5, 10);
    expect(est.source).toBe("mark");
    expect(est.ytm).toBe(5.2);
  });

  it("leaves the price unchanged with no duration anywhere", () => {
    const est = estimateBondPrice(
      makeHolding({ benchmark_tenor: 10, duration: null }),
      { ...mark, duration: null },
      flatCurve(4.0, "2026-09-01"),
      flatCurve(4.25, "2026-09-15")
    );
    expect(est.cleanPrice).toBeCloseTo(98.5, 10);
    expect(est.source).toBe("estimate");
  });
});
