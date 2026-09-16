// Treasury par yield curve: fetch/parse the daily Treasury XML feed, linear
// interpolation across tenors, and street-convention pricing of a Treasury
// holding off the par curve (SPEC 13.2).

import { XMLParser } from "fast-xml-parser";
import type { Holding, TreasuryCurvePoint } from "@/types/domain";
import { accruedInterest, nextCouponDates, remainingCouponDates } from "./accrued";

const MS_PER_DAY = 86_400_000;

/** Feed field → tenor in months, per the treasury_curve schema. */
const TENOR_FIELDS: ReadonlyArray<readonly [string, number]> = [
  ["BC_1MONTH", 1],
  ["BC_2MONTH", 2],
  ["BC_3MONTH", 3],
  ["BC_4MONTH", 4],
  ["BC_6MONTH", 6],
  ["BC_1YEAR", 12],
  ["BC_2YEAR", 24],
  ["BC_3YEAR", 36],
  ["BC_5YEAR", 60],
  ["BC_7YEAR", 84],
  ["BC_10YEAR", 120],
  ["BC_20YEAR", 240],
  ["BC_30YEAR", 360],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Fetch and parse the Treasury daily par yield curve XML (Atom feed) for a
 * calendar year. Returns one row per (date, tenor) with yields in percent.
 * Throws on network/HTTP failure; callers (the cron route) handle errors.
 */
export async function fetchTreasuryCurve(year: number): Promise<TreasuryCurvePoint[]> {
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const res = await fetch(url, {
    headers: { Accept: "application/xml, text/xml" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Treasury curve feed returned ${res.status} for year ${year}`);
  }
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: true,
    removeNSPrefix: true, // d:NEW_DATE → NEW_DATE, m:properties → properties
    parseTagValue: false, // keep values as strings; we coerce explicitly
  });
  const parsed: unknown = parser.parse(xml);
  if (!isRecord(parsed) || !isRecord(parsed.feed)) return [];

  const points: TreasuryCurvePoint[] = [];
  for (const entry of asArray(parsed.feed.entry)) {
    if (!isRecord(entry) || !isRecord(entry.content)) continue;
    const properties = entry.content.properties;
    if (!isRecord(properties)) continue;

    const rawDate = properties.NEW_DATE;
    if (typeof rawDate !== "string" || rawDate.length < 10) continue;
    const curve_date = rawDate.slice(0, 10);

    for (const [field, tenor_months] of TENOR_FIELDS) {
      const raw = properties[field];
      if (typeof raw !== "string" || raw.trim() === "") continue;
      const yield_pct = Number(raw);
      if (!Number.isFinite(yield_pct)) continue;
      points.push({ curve_date, tenor_months, yield_pct });
    }
  }
  return points;
}

/**
 * Linearly interpolate the par yield (in percent) at `tenorYears` from curve
 * rows. Clamps to the shortest/longest tenor outside the range. When rows from
 * several dates are passed, the latest date wins per tenor. Returns null for
 * an empty curve.
 */
export function interpolateYield(
  curve: TreasuryCurvePoint[],
  tenorYears: number
): number | null {
  const byTenor = new Map<number, number>();
  const sorted = [...curve].sort((a, b) => a.curve_date.localeCompare(b.curve_date));
  for (const p of sorted) {
    const tenor = Number(p.tenor_months);
    const y = Number(p.yield_pct);
    if (Number.isFinite(tenor) && Number.isFinite(y)) byTenor.set(tenor, y);
  }
  const points = [...byTenor.entries()]
    .map(([t, y]) => ({ t, y }))
    .sort((a, b) => a.t - b.t);
  if (points.length === 0) return null;

  const target = tenorYears * 12;
  if (target <= points[0].t) return points[0].y;
  const last = points[points.length - 1];
  if (target >= last.t) return last.y;

  for (let i = 1; i < points.length; i += 1) {
    const lo = points[i - 1];
    const hi = points[i];
    if (target <= hi.t) {
      const w = (target - lo.t) / (hi.t - lo.t);
      return lo.y + w * (hi.y - lo.y);
    }
  }
  return last.y; // unreachable, kept for safety
}

export interface TreasuryPrice {
  cleanPrice: number; // per 100 face
  accrued: number; // dollars on the holding's face
  ytm: number; // percent (= interpolated par yield)
  duration: number; // modified duration, years
}

/**
 * Price a Treasury holding off the par curve (approximation, usually within a
 * few cents of the quote): interpolate the par yield y at remaining maturity,
 * then discount remaining semiannual coupons + principal at y/2 per period,
 * street convention — discount factor (1 + y/2)^(-t) with t in periods and the
 * first period fraction = actual days to next coupon / actual days in period
 * (ACT/ACT). Returns clean price per 100 (dirty minus accrued per 100),
 * accrued dollars, ytm = y, and modified duration (Macaulay / (1 + y/2)).
 * Returns null when the holding has no maturity, is matured, or the curve is empty.
 */
export function priceTreasury(
  h: Holding,
  curve: TreasuryCurvePoint[],
  asOf: Date
): TreasuryPrice | null {
  if (!h.maturity_date) return null;
  const maturity = new Date(`${h.maturity_date.slice(0, 10)}T00:00:00Z`);
  const remainingDays = (maturity.getTime() - asOf.getTime()) / MS_PER_DAY;
  if (!(remainingDays > 0)) return null;

  const ytmPct = interpolateYield(curve, remainingDays / 365.25);
  if (ytmPct === null) return null;
  const y = ytmPct / 100;

  const freq = Number(h.payment_frequency ?? 2) > 0 ? Number(h.payment_frequency ?? 2) : 2;
  const couponPer100 = Number(h.coupon_rate ?? 0) / freq; // per period, per 100 face

  const flowDates = remainingCouponDates(h, asOf);
  if (flowDates.length === 0) return null;

  // First period fraction: actual days from asOf to the next coupon over
  // actual days in the current period (ACT/ACT street convention).
  const { next, daysInPeriod } = nextCouponDates(h, asOf);
  const daysToNext = Math.max(
    0,
    Math.round((next.getTime() - Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())) / MS_PER_DAY)
  );
  const w = daysToNext / daysInPeriod;

  let dirty = 0;
  let weighted = 0; // sum of t * PV(cf), t in periods
  const perPeriodRate = 1 + y / freq;
  flowDates.forEach((_, k) => {
    const t = w + k;
    const cf = couponPer100 + (k === flowDates.length - 1 ? 100 : 0);
    const pv = cf * Math.pow(perPeriodRate, -t);
    dirty += pv;
    weighted += t * pv;
  });
  if (!(dirty > 0)) return null;

  const accruedPer100 = couponPer100 * ((daysInPeriod - daysToNext) / daysInPeriod);
  const cleanPrice = dirty - accruedPer100;

  const macaulayYears = weighted / dirty / freq;
  const duration = macaulayYears / perPeriodRate;

  return {
    cleanPrice,
    accrued: accruedInterest(h, asOf),
    ytm: ytmPct,
    duration,
  };
}
