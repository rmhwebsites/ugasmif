// valueFund against a fake Supabase client (SPEC 13.5). Yahoo is mocked, so
// nothing here touches the network; every number below is hand-computable from
// the fixtures. The fake client is a chainable stub: the query builder methods
// return themselves, `maybeSingle()` yields one row and awaiting the chain
// yields the row list, which is the whole surface valueFund uses.

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BondMark,
  Fund,
  Holding,
  Quote,
  TreasuryCurvePoint,
} from "@/types/domain";

vi.mock("@/lib/yahoo", () => ({
  getQuotes: vi.fn(async (symbols: string[]) => {
    const out = new Map<string, Quote>();
    for (const symbol of symbols) {
      const quote = QUOTES[symbol];
      if (quote) out.set(symbol, quote);
    }
    return out;
  }),
}));

import { valueFund } from "@/lib/valuation";
import { priceTreasury } from "@/lib/bonds/treasury";

// ── Fixtures ────────────────────────────────────────────────────────────────

const FUND_ID = "fund-arch";
// 2026-04-01 12:00 ET. Picked so the 30/360 corporate sits exactly half way
// through its Jan 1 / Jul 1 coupon period.
const AS_OF = new Date(Date.UTC(2026, 3, 1, 16));

const QUOTES: Record<string, Quote> = {
  AAPL: {
    symbol: "AAPL",
    name: "Apple Inc.",
    price: 200,
    previousClose: 198,
    change: 2,
    changePercent: 1.0101,
    stale: false,
    asOf: AS_OF.toISOString(),
  },
};

function makeFund(overrides: Partial<Fund> = {}): Fund {
  return {
    id: FUND_ID,
    slug: "arch",
    name: "Arch Fund",
    asset_class: "fixed_income",
    benchmark_symbol: "AGG",
    benchmark_name: "Bloomberg US Aggregate",
    vote_pass_threshold_pct: 60,
    vote_quorum_pct: 50,
    vote_default_window_hours: 48,
    cash_balance: 10_000,
    inception_date: "2020-09-01",
    meeting_day: 3,
    allowed_email_domains: ["uga.edu"],
    settings: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeHolding(overrides: Partial<Holding> & { id: string }): Holding {
  return {
    fund_id: FUND_ID,
    sector_id: null,
    instrument_type: "corporate",
    symbol: null,
    cusip: null,
    isin: null,
    name: "Holding",
    issuer: null,
    quantity: 0,
    avg_cost: 0,
    coupon_rate: null,
    maturity_date: null,
    issue_date: null,
    first_coupon_date: null,
    payment_frequency: null,
    day_count: null,
    rating: null,
    duration: null,
    ytm: null,
    pricing_method: "live",
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

function makeMark(overrides: Partial<BondMark> & { holding_id: string }): BondMark {
  return {
    id: `mark-${overrides.holding_id}`,
    clean_price: 100,
    ytm: null,
    duration: null,
    source: "bloomberg",
    marked_by: "user-pm",
    marked_at: "2026-03-01T15:00:00Z",
    notes: null,
    ...overrides,
  };
}

const TENOR_MONTHS = [1, 2, 3, 4, 6, 12, 24, 36, 60, 84, 120, 240, 360];

function flatCurve(yieldPct: number, curveDate: string): TreasuryCurvePoint[] {
  return TENOR_MONTHS.map((tenor_months) => ({
    curve_date: curveDate,
    tenor_months,
    yield_pct: yieldPct,
  }));
}

const EQUITY = makeHolding({
  id: "h-equity",
  instrument_type: "equity",
  symbol: "AAPL",
  name: "Apple Inc.",
  quantity: 100,
  avg_cost: 150,
  pricing_method: "live",
});

// 4% semiannual, 30/360, Jan 1 / Jul 1 coupons. Accrued at AS_OF is exactly
// half a period: 100,000 × 4% / 2 × 90/180 = 1,000.
const CORPORATE = makeHolding({
  id: "h-corp",
  instrument_type: "corporate",
  name: "Acme 4% 2030",
  quantity: 100_000,
  avg_cost: 99,
  coupon_rate: 4,
  maturity_date: "2030-01-01",
  payment_frequency: 2,
  day_count: "30/360",
  duration: 6,
  ytm: 4.2,
  pricing_method: "manual",
});
const CORPORATE_ACCRUED = 1_000;
const CORPORATE_MARK = makeMark({
  holding_id: CORPORATE.id,
  clean_price: 98.5,
  ytm: 4.4,
  duration: 6,
  marked_at: "2026-03-01T15:00:00Z", // 31 days before AS_OF → stale
});

// 3% semiannual ACT/ACT, Jan 1 / Jul 1: 90 of 181 actual days accrued.
const TREASURY = makeHolding({
  id: "h-ust",
  instrument_type: "treasury",
  name: "UST 3% 2031",
  quantity: 50_000,
  avg_cost: 100,
  coupon_rate: 3,
  maturity_date: "2031-01-01",
  payment_frequency: 2,
  day_count: "ACT/ACT",
  pricing_method: "treasury_curve",
});
const TREASURY_ACCRUED = ((50_000 * 0.03) / 2) * (90 / 181);
const TREASURY_MARK = makeMark({
  holding_id: TREASURY.id,
  clean_price: 101,
  ytm: 3.5,
  duration: 4,
  marked_at: "2026-03-31T20:00:00Z", // Eastern 2026-03-31
});

const CASH_SWEEP = makeHolding({
  id: "h-mmf",
  instrument_type: "money_market",
  name: "Cash sweep",
  quantity: 25_000,
  avg_cost: 1,
  pricing_method: "manual",
});

// ── Fake Supabase client ────────────────────────────────────────────────────

type Row = Record<string, unknown>;

interface QueryStub {
  select: () => QueryStub;
  eq: () => QueryStub;
  lte: () => QueryStub;
  in: () => QueryStub;
  order: () => QueryStub;
  limit: () => QueryStub;
  maybeSingle: () => Promise<{ data: Row | null }>;
  then: <T>(resolve: (value: { data: Row[] }) => T) => Promise<T>;
}

/**
 * `rows` is what awaiting the chain returns; `single` is what `maybeSingle()`
 * returns. They differ only for treasury_curve, where valueFund first resolves
 * the max curve_date with maybeSingle and then reads that date's tenor rows.
 */
function queryStub(rows: Row[], single: Row | null = rows[0] ?? null): QueryStub {
  const stub: QueryStub = {
    select: () => stub,
    eq: () => stub,
    lte: () => stub,
    in: () => stub,
    order: () => stub,
    limit: () => stub,
    maybeSingle: async () => ({ data: single }),
    then: (resolve) => Promise.resolve({ data: rows }).then(resolve),
  };
  return stub;
}

interface Fixtures {
  fund?: Fund;
  holdings?: Holding[];
  marks?: BondMark[];
  curve?: TreasuryCurvePoint[];
}

function fakeClient(fixtures: Fixtures) {
  const fund = fixtures.fund ?? makeFund();
  const curve = fixtures.curve ?? [];
  // valueFund reads the first mark per holding_id, so hand them back newest
  // first exactly as the ordered query would.
  const marks = [...(fixtures.marks ?? [])].sort(
    (a, b) => new Date(b.marked_at).getTime() - new Date(a.marked_at).getTime()
  );
  return {
    from(table: string): QueryStub {
      switch (table) {
        case "funds":
          return queryStub([fund as unknown as Row]);
        case "holdings":
          return queryStub((fixtures.holdings ?? []) as unknown as Row[]);
        case "bond_marks":
          return queryStub(marks as unknown as Row[]);
        case "treasury_curve":
          return queryStub(
            curve as unknown as Row[],
            curve.length > 0 ? { curve_date: curve[0].curve_date } : null
          );
        case "sectors":
        case "sector_targets":
          return queryStub([]);
        default:
          throw new Error(`fakeClient: unexpected table ${table}`);
      }
    },
  };
}

function clientFor(fixtures: Fixtures): SupabaseClient {
  return fakeClient(fixtures) as unknown as SupabaseClient;
}

const FULL_FIXTURES: Fixtures = {
  holdings: [EQUITY, CORPORATE, TREASURY, CASH_SWEEP],
  marks: [CORPORATE_MARK, TREASURY_MARK],
  curve: flatCurve(4, "2026-03-30"), // older than TREASURY_MARK
};

function valueFullFund() {
  return valueFund(clientFor(FULL_FIXTURES), FUND_ID, AS_OF);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("valueFund market values", () => {
  it("prices an equity at quantity × quote price", async () => {
    const v = await valueFullFund();
    const equity = v.holdings.find((h) => h.holding.id === EQUITY.id);
    expect(equity?.price).toBe(200);
    expect(equity?.priceSource).toBe("live");
    expect(equity?.marketValue).toBe(100 * 200);
    expect(equity?.costBasis).toBe(100 * 150);
    expect(equity?.dayChange).toBe(200);
  });

  it("prices a bond at clean/100 × face plus accrued", async () => {
    const v = await valueFullFund();
    const bond = v.holdings.find((h) => h.holding.id === CORPORATE.id);
    expect(bond?.accruedInterest).toBeCloseTo(CORPORATE_ACCRUED, 9);
    expect(bond?.marketValue).toBeCloseTo(
      (98.5 / 100) * 100_000 + CORPORATE_ACCRUED,
      9
    );
    // avg_cost is per 100 face for bonds.
    expect(bond?.costBasis).toBeCloseTo(99_000, 9);
  });

  it("prices a money market holding with no symbol at par", async () => {
    const v = await valueFullFund();
    const mmf = v.holdings.find((h) => h.holding.id === CASH_SWEEP.id);
    expect(mmf?.price).toBe(1);
    expect(mmf?.priceSource).toBe("par");
    expect(mmf?.marketValue).toBe(25_000);
  });

  it("weights every holding plus cash to 100%", async () => {
    const v = await valueFullFund();
    const holdingsPct = v.holdings.reduce((s, h) => s + h.weightPct, 0);
    const cashPct = (v.cash / v.totalValue) * 100;
    expect(holdingsPct + cashPct).toBeCloseTo(100, 9);
    expect(v.cash).toBe(10_000);
    expect(v.totalValue).toBeCloseTo(v.securitiesValue + v.cash, 9);
  });

  it("totals byInstrumentType to the securities value", async () => {
    const v = await valueFullFund();
    expect(v.byInstrumentType.equity).toBe(20_000);
    expect(v.byInstrumentType.money_market).toBe(25_000);
    expect(v.byInstrumentType.corporate).toBeCloseTo(99_500, 9);
    expect(v.byInstrumentType.treasury).toBeCloseTo(
      (101 / 100) * 50_000 + TREASURY_ACCRUED,
      9
    );
    const sum = Object.values(v.byInstrumentType).reduce((s, n) => s + n, 0);
    expect(sum).toBeCloseTo(v.securitiesValue, 9);
  });
});

describe("valueFund mark staleness", () => {
  it("flags a manual bond whose mark is older than the fund threshold", async () => {
    const v = await valueFullFund();
    const bond = v.holdings.find((h) => h.holding.id === CORPORATE.id);
    expect(bond?.priceSource).toBe("mark");
    expect(bond?.markedAt).toBe(CORPORATE_MARK.marked_at);
    expect(bond?.stale).toBe(true);
    expect(v.anyStale).toBe(true);
  });

  it("does not flag a mark inside the threshold", async () => {
    const v = await valueFullFund();
    const ust = v.holdings.find((h) => h.holding.id === TREASURY.id);
    expect(ust?.stale).toBe(false);
  });
});

describe("valueFund bond provider dispatch (SPEC 13.4)", () => {
  it("ages a benchmarked mark forward through the curve-drift estimate", async () => {
    const drifting = makeHolding({ ...CORPORATE, benchmark_tenor: 5 });
    const v = await valueFund(
      clientFor({ ...FULL_FIXTURES, holdings: [drifting] }),
      FUND_ID,
      AS_OF
    );
    const bond = v.holdings.find((h) => h.holding.id === drifting.id);
    // The fixture curve is unchanged between the mark date and today, so the
    // price is the mark — but it is labelled "est." because it was aged.
    expect(bond?.priceSource).toBe("estimate");
    expect(bond?.price).toBeCloseTo(98.5, 9);
  });
});

describe("valueFund Treasury mark override (SPEC 13.2)", () => {
  it("uses a mark that is newer than the curve date", async () => {
    const v = await valueFullFund();
    const ust = v.holdings.find((h) => h.holding.id === TREASURY.id);
    expect(ust?.priceSource).toBe("mark");
    expect(ust?.price).toBe(101);
    expect(ust?.markedAt).toBe(TREASURY_MARK.marked_at);
    expect(ust?.marketValue).toBeCloseTo(
      (101 / 100) * 50_000 + TREASURY_ACCRUED,
      9
    );
    expect(ust?.duration).toBe(4);
    expect(ust?.ytm).toBe(3.5);
  });

  it("goes back to the curve once the curve is newer than the mark", async () => {
    const curve = flatCurve(4, "2026-04-01"); // after TREASURY_MARK
    const v = await valueFund(
      clientFor({ ...FULL_FIXTURES, curve }),
      FUND_ID,
      AS_OF
    );
    const ust = v.holdings.find((h) => h.holding.id === TREASURY.id);
    const expected = priceTreasury(TREASURY, curve, AS_OF);
    expect(ust?.priceSource).toBe("curve");
    expect(expected).not.toBeNull();
    expect(ust?.price).toBeCloseTo(expected?.cleanPrice ?? 0, 9);
    expect(ust?.duration).toBeCloseTo(expected?.duration ?? 0, 9);
  });
});

describe("valueFund weighted duration and YTM", () => {
  it("weights by market value over bond holdings only", async () => {
    const v = await valueFullFund();
    const corpMv = (98.5 / 100) * 100_000 + CORPORATE_ACCRUED;
    const ustMv = (101 / 100) * 50_000 + TREASURY_ACCRUED;
    const bondMv = corpMv + ustMv;

    expect(v.weightedDuration).toBeCloseTo((corpMv * 6 + ustMv * 4) / bondMv, 9);
    expect(v.weightedYtm).toBeCloseTo((corpMv * 4.4 + ustMv * 3.5) / bondMv, 9);
    // The equity and the money market sweep carry no duration and must not
    // dilute the reading.
    expect(v.weightedDuration).toBeGreaterThan(4);
    expect(v.weightedDuration).toBeLessThan(6);
  });

  it("leaves duration and YTM null for an equity fund", async () => {
    const v = await valueFund(
      clientFor({ ...FULL_FIXTURES, fund: makeFund({ asset_class: "equity" }) }),
      FUND_ID,
      AS_OF
    );
    expect(v.weightedDuration).toBeNull();
    expect(v.weightedYtm).toBeNull();
  });
});
