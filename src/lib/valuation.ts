// Fund valuation (SPEC 13.5): one function every page and the EOD snapshot
// use. Prices each active holding by pricing_method + instrument_type, joins
// sector weights to the latest targets, and rolls up fund totals.
//
// Pricing decision tree (CONTRACTS.md):
//   - money_market with no symbol         → 1.00, source "par" (cash sweep)
//   - pricing_method "live" (has symbol)  → getQuotes() batch, source "live"
//   - pricing_method "treasury_curve"     → priceTreasury() off the latest
//                                           treasury_curve date, source "curve"
//   - pricing_method "manual"             → latest bond_marks row through
//                                           estimateBondPrice(), source "mark"
//                                           (marked today / no curve) or
//                                           "estimate" (curve-drifted)
//
// Market value: equity-types = quantity × price; bond-types =
// (clean + accrued per 100) / 100 × face  (accrued from @/lib/bonds/accrued;
// money market accrues nothing). Cost basis: equity-types quantity × avg_cost;
// bond-types face × avg_cost / 100 (avg_cost is per 100 face).
//
// Day change: equities carry the quote's change × quantity. Bond day change
// is 0 by design — marks and curve prices have no intraday "previous close",
// and we do not store yesterday's estimate per holding, so pretending a daily
// move would be noise. The fund's day change is therefore equity-driven; the
// EOD snapshot series is where bond drift shows up. Fund dayChange = Σ holding
// day changes; dayChangePct = dayChange / (totalValue − dayChange) × 100.
//
// Failure honesty: when a price cannot be produced (Yahoo outage with no
// snapshot, missing mark, empty curve) the holding keeps price = null, falls
// back to cost basis (+ accrued for bonds) for market value so totals stay
// meaningful, and is flagged stale.
//
// PostgREST returns numeric columns as strings past JS float range — every
// value used in math is coerced with Number().

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BondMark,
  Fund,
  FundValuation,
  Holding,
  HoldingValuation,
  Quote,
  Sector,
  SectorTarget,
  SectorWeight,
  TreasuryCurvePoint,
} from "@/types/domain";
import { getQuotes } from "@/lib/yahoo";
import { accruedInterest } from "@/lib/bonds/accrued";
import { priceTreasury } from "@/lib/bonds/treasury";
import { estimateBondPrice } from "@/lib/bonds/estimate";
import { easternDateString } from "@/lib/format";

const MS_PER_DAY = 86_400_000;
const DEFAULT_STALE_MARK_DAYS = 7;

const BOND_TYPES = new Set(["treasury", "corporate", "agency_mbs", "municipal"]);

function isBondType(h: Holding): boolean {
  return BOND_TYPES.has(h.instrument_type);
}

/** Cost basis in dollars: bonds carry avg_cost per 100 face. */
function costBasisOf(h: Holding): number {
  const qty = Number(h.quantity);
  const avg = Number(h.avg_cost);
  if (!Number.isFinite(qty) || !Number.isFinite(avg)) return 0;
  return isBondType(h) ? (qty * avg) / 100 : qty * avg;
}

/**
 * Latest treasury_curve rows on or before `dateStr` (YYYY-MM-DD): resolve the
 * max curve_date, then fetch that date's tenor rows. Null when the table has
 * nothing that early.
 */
async function curveOnOrBefore(
  supabase: SupabaseClient,
  dateStr: string
): Promise<TreasuryCurvePoint[] | null> {
  const { data: dateRow } = await supabase
    .from("treasury_curve")
    .select("curve_date")
    .lte("curve_date", dateStr)
    .order("curve_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curveDate = (dateRow as { curve_date: string } | null)?.curve_date;
  if (!curveDate) return null;

  const { data } = await supabase
    .from("treasury_curve")
    .select("curve_date, tenor_months, yield_pct")
    .eq("curve_date", curveDate);
  const rows = (data as TreasuryCurvePoint[] | null) ?? [];
  return rows.length > 0 ? rows : null;
}

interface PricedHolding {
  holding: Holding;
  price: number | null;
  priceSource: HoldingValuation["priceSource"];
  markedAt: string | null;
  stale: boolean;
  accruedInterest: number;
  marketValue: number;
  costBasis: number;
  dayChange: number | null;
  dayChangePct: number | null;
  ytm: number | null;
  duration: number | null;
}

function priceOne(
  h: Holding,
  ctx: {
    asOf: Date;
    quotes: Map<string, Quote>;
    marks: Map<string, BondMark>;
    curveNow: TreasuryCurvePoint[] | null;
    curveAtMark: Map<string, TreasuryCurvePoint[] | null>;
    staleMarkDays: number;
  }
): PricedHolding {
  const qty = Number(h.quantity);
  const costBasis = costBasisOf(h);
  const holdingYtm = h.ytm !== null ? Number(h.ytm) : null;
  const holdingDuration = h.duration !== null ? Number(h.duration) : null;

  const base: PricedHolding = {
    holding: h,
    price: null,
    priceSource: "live",
    markedAt: null,
    stale: false,
    accruedInterest: 0,
    marketValue: costBasis,
    costBasis,
    dayChange: null,
    dayChangePct: null,
    ytm: holdingYtm,
    duration: holdingDuration,
  };

  // Money market with no symbol: par, no accrual, no day change.
  if (h.instrument_type === "money_market" && !h.symbol) {
    return {
      ...base,
      price: 1,
      priceSource: "par",
      marketValue: qty * 1,
      dayChange: 0,
      dayChangePct: 0,
    };
  }

  if (h.pricing_method === "live") {
    const quote = h.symbol ? ctx.quotes.get(h.symbol) : undefined;
    if (!quote) {
      // No quote, no snapshot fallback: keep cost basis, flag stale.
      return { ...base, stale: true };
    }
    const price = Number(quote.price);
    if (isBondType(h)) {
      // A live-priced bond quote is a clean price per 100 face.
      const accrued = accruedInterest(h, ctx.asOf);
      return {
        ...base,
        price,
        priceSource: "live",
        stale: quote.stale,
        accruedInterest: accrued,
        marketValue: (price / 100) * qty + accrued,
        dayChange: 0,
        dayChangePct: 0,
      };
    }
    return {
      ...base,
      price,
      priceSource: "live",
      stale: quote.stale,
      marketValue: qty * price,
      dayChange: quote.change !== null ? Number(quote.change) * qty : null,
      dayChangePct: quote.changePercent !== null ? Number(quote.changePercent) : null,
    };
  }

  if (h.pricing_method === "treasury_curve") {
    const accrued = accruedInterest(h, ctx.asOf);
    const priced = ctx.curveNow ? priceTreasury(h, ctx.curveNow, ctx.asOf) : null;
    if (!priced) {
      // No curve yet (or matured): cost + accrued, flagged for the checklist.
      return {
        ...base,
        priceSource: "curve",
        stale: true,
        accruedInterest: accrued,
        marketValue: costBasis + accrued,
        dayChange: 0,
        dayChangePct: 0,
      };
    }
    return {
      ...base,
      price: priced.cleanPrice,
      priceSource: "curve",
      accruedInterest: priced.accrued,
      marketValue: (priced.cleanPrice / 100) * qty + priced.accrued,
      dayChange: 0, // curve prices have no previous close — documented above
      dayChangePct: 0,
      ytm: priced.ytm,
      duration: priced.duration,
    };
  }

  // pricing_method === "manual"
  const accrued = accruedInterest(h, ctx.asOf);
  const mark = ctx.marks.get(h.id);
  if (!mark) {
    // Never marked: cost + accrued, stale so the PM checklist surfaces it.
    return {
      ...base,
      priceSource: "mark",
      stale: true,
      accruedInterest: accrued,
      marketValue: costBasis + accrued,
      dayChange: 0,
      dayChangePct: 0,
    };
  }
  const markDate = easternDateString(new Date(mark.marked_at));
  const est = estimateBondPrice(h, mark, ctx.curveAtMark.get(markDate) ?? null, ctx.curveNow);
  const ageDays = (ctx.asOf.getTime() - new Date(mark.marked_at).getTime()) / MS_PER_DAY;
  return {
    ...base,
    price: est.cleanPrice,
    priceSource: est.source,
    markedAt: est.markedAt,
    stale: ageDays > ctx.staleMarkDays,
    accruedInterest: accrued,
    marketValue: (est.cleanPrice / 100) * qty + accrued,
    dayChange: 0, // yesterday's estimate is not stored — documented above
    dayChangePct: 0,
    ytm: est.ytm ?? holdingYtm,
    duration: est.duration ?? holdingDuration,
  };
}

/**
 * Value a fund as of now (or `asOf`): per-holding price/source/accrued/market
 * value/weight, sector weights vs latest targets, and fund totals. Uses the
 * PASSED-IN client, so user calls run under RLS and cron calls run with the
 * service role unchanged. Throws when the fund row is not readable.
 */
export async function valueFund(
  supabase: SupabaseClient,
  fundId: string,
  asOf: Date = new Date()
): Promise<FundValuation> {
  const today = easternDateString(asOf);

  const [fundRes, holdingsRes, sectorsRes, targetsRes] = await Promise.all([
    supabase.from("funds").select("*").eq("id", fundId).maybeSingle(),
    supabase
      .from("holdings")
      .select("*")
      .eq("fund_id", fundId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("sectors")
      .select("*")
      .eq("fund_id", fundId)
      .order("sort_order"),
    supabase
      .from("sector_targets")
      .select("*")
      .eq("fund_id", fundId)
      .lte("effective_on", today)
      .order("effective_on", { ascending: false }),
  ]);

  const fund = fundRes.data as Fund | null;
  if (!fund) {
    throw new Error(`valueFund: fund ${fundId} not found or not accessible`);
  }
  const holdings = (holdingsRes.data as Holding[] | null) ?? [];
  const sectors = (sectorsRes.data as Sector[] | null) ?? [];
  const targetRows = (targetsRes.data as SectorTarget[] | null) ?? [];

  // Latest target per sector (rows already sorted by effective_on desc).
  const latestTarget = new Map<string, SectorTarget>();
  for (const t of targetRows) {
    if (!latestTarget.has(t.sector_id)) latestTarget.set(t.sector_id, t);
  }

  // Live quotes: one batch for every symbol priced live (equity, ETF, and
  // money market funds with a ticker).
  const liveSymbols = holdings
    .filter((h) => h.pricing_method === "live" && h.symbol)
    .map((h) => h.symbol as string);
  const quotesPromise: Promise<Map<string, Quote>> =
    liveSymbols.length > 0 ? getQuotes(liveSymbols) : Promise.resolve(new Map());

  // Latest mark per manual holding.
  const manualIds = holdings
    .filter((h) => h.pricing_method === "manual")
    .map((h) => h.id);
  const marksPromise: Promise<Map<string, BondMark>> = (async () => {
    const latest = new Map<string, BondMark>();
    if (manualIds.length === 0) return latest;
    const { data } = await supabase
      .from("bond_marks")
      .select("*")
      .in("holding_id", manualIds)
      .order("marked_at", { ascending: false });
    for (const m of (data as BondMark[] | null) ?? []) {
      if (!latest.has(m.holding_id)) latest.set(m.holding_id, m);
    }
    return latest;
  })();

  const needsCurve =
    holdings.some((h) => h.pricing_method === "treasury_curve") || manualIds.length > 0;
  const curvePromise: Promise<TreasuryCurvePoint[] | null> = needsCurve
    ? curveOnOrBefore(supabase, today)
    : Promise.resolve(null);

  const [quotes, marks, curveNow] = await Promise.all([
    quotesPromise,
    marksPromise,
    curvePromise,
  ]);

  // Curve rows as of each distinct mark date, for estimateBondPrice drift.
  const curveAtMark = new Map<string, TreasuryCurvePoint[] | null>();
  const markDates = new Set<string>();
  for (const mark of marks.values()) {
    const d = easternDateString(new Date(mark.marked_at));
    if (d !== today) markDates.add(d); // today's marks never drift
  }
  await Promise.all(
    [...markDates].map(async (d) => {
      curveAtMark.set(d, await curveOnOrBefore(supabase, d));
    })
  );

  const staleMarkDays = Number(fund.settings?.stale_mark_days ?? DEFAULT_STALE_MARK_DAYS);
  const priced = holdings.map((h) =>
    priceOne(h, { asOf, quotes, marks, curveNow, curveAtMark, staleMarkDays })
  );

  const securitiesValue = priced.reduce((s, p) => s + p.marketValue, 0);
  const cash = Number(fund.cash_balance);
  const totalValue = securitiesValue + cash;

  const sectorNames = new Map(sectors.map((s) => [s.id, s.name]));
  const holdingVals: HoldingValuation[] = priced.map((p) => ({
    holding: p.holding,
    sectorName: p.holding.sector_id
      ? sectorNames.get(p.holding.sector_id) ?? null
      : null,
    price: p.price,
    priceSource: p.priceSource,
    markedAt: p.markedAt,
    stale: p.stale,
    accruedInterest: p.accruedInterest,
    marketValue: p.marketValue,
    costBasis: p.costBasis,
    unrealizedGain: p.marketValue - p.costBasis,
    weightPct: totalValue > 0 ? (p.marketValue / totalValue) * 100 : 0,
    dayChange: p.dayChange,
    dayChangePct: p.dayChangePct,
    ytm: p.ytm,
    duration: p.duration,
  }));

  // Sector weights: every active sector appears (a 0% row vs a target is
  // information), plus any inactive sector that still holds positions.
  const bySector = new Map<string, { marketValue: number; count: number }>();
  for (const v of holdingVals) {
    const sid = v.holding.sector_id;
    if (!sid) continue;
    const agg = bySector.get(sid) ?? { marketValue: 0, count: 0 };
    agg.marketValue += v.marketValue;
    agg.count += 1;
    bySector.set(sid, agg);
  }
  const sectorWeights: SectorWeight[] = sectors
    .filter((s) => s.is_active || bySector.has(s.id))
    .map((s) => {
      const agg = bySector.get(s.id) ?? { marketValue: 0, count: 0 };
      const target = latestTarget.get(s.id);
      return {
        sectorId: s.id,
        sectorName: s.name,
        sectorSlug: s.slug,
        isStrategyTeam: s.is_strategy_team,
        marketValue: agg.marketValue,
        weightPct: totalValue > 0 ? (agg.marketValue / totalValue) * 100 : 0,
        targetWeightPct: target ? Number(target.target_weight_pct) : null,
        benchmarkWeightPct:
          target && target.benchmark_weight_pct !== null
            ? Number(target.benchmark_weight_pct)
            : null,
        holdingsCount: agg.count,
      };
    });

  // Fund day change = Σ per-position day changes (GBH's approach applied per
  // position); percent is against yesterday's implied total.
  const dayChange = holdingVals.reduce((s, v) => s + (v.dayChange ?? 0), 0);
  const previousTotal = totalValue - dayChange;
  const dayChangePct = previousTotal > 0 ? (dayChange / previousTotal) * 100 : 0;

  // Weighted duration / YTM for fixed-income funds, market-value weighted
  // over bond-type holdings only (cash, money market, and equity-types are
  // excluded — they would dilute the portfolio's rate exposure reading).
  let weightedDuration: number | null = null;
  let weightedYtm: number | null = null;
  if (fund.asset_class === "fixed_income") {
    const bonds = holdingVals.filter(
      (v) => isBondType(v.holding) && v.marketValue > 0
    );
    const durBase = bonds.filter((v) => v.duration !== null);
    const durMv = durBase.reduce((s, v) => s + v.marketValue, 0);
    if (durMv > 0) {
      weightedDuration =
        durBase.reduce((s, v) => s + v.marketValue * (v.duration as number), 0) / durMv;
    }
    const ytmBase = bonds.filter((v) => v.ytm !== null);
    const ytmMv = ytmBase.reduce((s, v) => s + v.marketValue, 0);
    if (ytmMv > 0) {
      weightedYtm =
        ytmBase.reduce((s, v) => s + v.marketValue * (v.ytm as number), 0) / ytmMv;
    }
  }

  const byInstrumentType: Record<string, number> = {};
  for (const v of holdingVals) {
    const key = v.holding.instrument_type;
    byInstrumentType[key] = (byInstrumentType[key] ?? 0) + v.marketValue;
  }

  return {
    fundId,
    asOf: asOf.toISOString(),
    holdings: holdingVals,
    sectors: sectorWeights,
    securitiesValue,
    cash,
    totalValue,
    dayChange,
    dayChangePct,
    weightedDuration,
    weightedYtm,
    byInstrumentType,
    anyStale: holdingVals.some((v) => v.stale),
  };
}
