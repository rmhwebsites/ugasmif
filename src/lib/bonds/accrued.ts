// Day-count-aware accrued interest and coupon schedules for bond holdings.
// Pure functions — no I/O. Dates are handled in UTC to avoid timezone drift.
//
// Conventions (SPEC 13.3):
//   accrued = face * coupon/100 / frequency * (days since last coupon / days in period)
//   30/360 (US): 30/360 day counts, period = 360/frequency days
//   ACT/ACT:     actual days elapsed / actual days in the current period
//   ACT/360:     actual days elapsed, period = 360/frequency days

import type { DayCount, Holding } from "@/types/domain";

const MS_PER_DAY = 86_400_000;
const MAX_PERIODS = 2_400; // safety bound (~100 years of monthly coupons)

/** Parse a date-only string ("YYYY-MM-DD" or an ISO timestamp) as UTC midnight. */
function parseDateUTC(value: string): Date {
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
}

/** UTC midnight of an arbitrary Date (drops the time component). */
function toUTCDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Add calendar months in UTC, clamping to the end of the target month. */
function addMonthsUTC(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

/** Actual calendar days between two UTC dates. */
function actualDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/** 30/360 US (NASD) day count between two dates. */
function days30360US(from: Date, to: Date): number {
  let d1 = from.getUTCDate();
  let d2 = to.getUTCDate();
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;
  return (
    360 * (to.getUTCFullYear() - from.getUTCFullYear()) +
    30 * (to.getUTCMonth() - from.getUTCMonth()) +
    (d2 - d1)
  );
}

function couponFrequency(h: Holding): number {
  const freq = Number(h.payment_frequency ?? 2);
  return Number.isFinite(freq) && freq > 0 ? freq : 2;
}

function monthsPerPeriod(freq: number): number {
  const step = 12 / freq;
  return Number.isFinite(step) && step >= 1 ? Math.round(step) : 6;
}

/**
 * The coupon period bracketing `asOf`, derived from `maturity_date` stepping
 * back 12/payment_frequency months at a time (each date computed as a whole
 * multiple of the step from maturity, so month-end clamping never drifts).
 * `first_coupon_date` is honored when set: while `asOf` is before it, the next
 * coupon is the first coupon date and accrual starts at `issue_date` when known.
 * `daysInPeriod` is actual calendar days between prev and next.
 */
export function nextCouponDates(
  h: Holding,
  asOf: Date
): { prev: Date; next: Date; daysInPeriod: number } {
  if (!h.maturity_date) {
    throw new Error(`nextCouponDates: holding ${h.id} has no maturity_date`);
  }
  const maturity = parseDateUTC(h.maturity_date);
  const on = toUTCDate(asOf);
  const step = monthsPerPeriod(couponFrequency(h));

  let n = 1;
  while (n < MAX_PERIODS && addMonthsUTC(maturity, -n * step).getTime() > on.getTime()) {
    n += 1;
  }
  let prev = addMonthsUTC(maturity, -n * step);
  let next = addMonthsUTC(maturity, -(n - 1) * step);

  if (h.first_coupon_date) {
    const firstCoupon = parseDateUTC(h.first_coupon_date);
    if (on.getTime() < firstCoupon.getTime()) {
      next = firstCoupon;
      prev = h.issue_date ? parseDateUTC(h.issue_date) : prev;
    }
  }

  const daysInPeriod = Math.max(1, actualDays(prev, next));
  return { prev, next, daysInPeriod };
}

/** Fraction of the current coupon accrued as of `asOf`, per the day count. */
function accrualFraction(
  dayCount: DayCount,
  freq: number,
  prev: Date,
  next: Date,
  asOf: Date
): number {
  let fraction: number;
  if (dayCount === "ACT/ACT") {
    fraction = actualDays(prev, asOf) / Math.max(1, actualDays(prev, next));
  } else if (dayCount === "ACT/360") {
    fraction = actualDays(prev, asOf) / (360 / freq);
  } else {
    // 30/360 US
    fraction = days30360US(prev, asOf) / (360 / freq);
  }
  return Math.max(0, fraction);
}

/**
 * Accrued interest in DOLLARS on the holding's face as of `asOf`.
 * `quantity` is face value in dollars; `coupon_rate` is in percent (e.g. 4.25).
 * Returns 0 for non-coupon holdings, matured bonds, or missing bond fields.
 */
export function accruedInterest(h: Holding, asOf: Date): number {
  if (!h.maturity_date) return 0;
  const coupon = Number(h.coupon_rate ?? 0);
  const face = Number(h.quantity);
  if (!Number.isFinite(coupon) || coupon <= 0) return 0;
  if (!Number.isFinite(face) || face <= 0) return 0;

  const on = toUTCDate(asOf);
  const maturity = parseDateUTC(h.maturity_date);
  if (on.getTime() >= maturity.getTime()) return 0;

  const freq = couponFrequency(h);
  const { prev, next } = nextCouponDates(h, asOf);
  if (on.getTime() <= prev.getTime()) return 0;

  const dayCount: DayCount = h.day_count ?? "30/360";
  const fraction = accrualFraction(dayCount, freq, prev, next, on);
  return face * (coupon / 100) / freq * fraction;
}

/**
 * All remaining coupon-cycle dates strictly after `asOf`, ascending, ending at
 * maturity. Includes cycle dates even for zero-coupon holdings (pricing needs
 * the period count). Not part of the module contract — exported for treasury.ts.
 */
export function remainingCouponDates(h: Holding, asOf: Date): Date[] {
  if (!h.maturity_date) return [];
  const maturity = parseDateUTC(h.maturity_date);
  const on = toUTCDate(asOf);
  if (maturity.getTime() <= on.getTime()) return [];

  const step = monthsPerPeriod(couponFrequency(h));
  const firstCoupon = h.first_coupon_date ? parseDateUTC(h.first_coupon_date) : null;

  const dates: Date[] = [];
  for (let i = 0; i < MAX_PERIODS; i += 1) {
    const d = addMonthsUTC(maturity, -i * step);
    if (d.getTime() <= on.getTime()) break;
    if (firstCoupon && d.getTime() < firstCoupon.getTime()) break;
    dates.push(d);
  }
  if (
    firstCoupon &&
    firstCoupon.getTime() > on.getTime() &&
    firstCoupon.getTime() < maturity.getTime() &&
    !dates.some((d) => d.getTime() === firstCoupon.getTime())
  ) {
    dates.push(firstCoupon);
  }
  dates.sort((a, b) => a.getTime() - b.getTime());
  return dates;
}

/**
 * Remaining cash flows: each coupon pays face * coupon/100 / frequency, and
 * the final (maturity) entry additionally returns principal (face).
 */
export function couponSchedule(h: Holding, asOf: Date): { date: Date; amount: number }[] {
  const dates = remainingCouponDates(h, asOf);
  if (dates.length === 0) return [];

  const face = Number(h.quantity);
  const coupon = Number(h.coupon_rate ?? 0);
  const freq = couponFrequency(h);
  const couponAmount =
    Number.isFinite(coupon) && coupon > 0 && Number.isFinite(face)
      ? (face * (coupon / 100)) / freq
      : 0;

  const maturityTime = parseDateUTC(h.maturity_date as string).getTime();
  return dates
    .map((date) => ({
      date,
      amount: couponAmount + (date.getTime() === maturityTime ? face : 0),
    }))
    .filter((flow) => flow.amount > 0);
}
