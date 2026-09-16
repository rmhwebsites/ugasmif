// Between manual marks, move a bond's price with the Treasury curve (SPEC 13.3):
//   estimated_price = last_mark_price * (1 - duration * delta_yield)
// where delta_yield is the change (in decimal) in the interpolated par yield at
// the holding's benchmark_tenor since the mark date. A 25bp rise with duration
// 6 knocks ~1.5% off the price. Labeled "est." in the UI with the mark date.

import type { BondMark, Holding, TreasuryCurvePoint } from "@/types/domain";
import { easternDateString } from "@/lib/format";
import { interpolateYield } from "./treasury";

export interface BondEstimate {
  cleanPrice: number;
  source: "mark" | "estimate";
  markedAt: string;
  ytm: number | null;
  duration: number | null;
}

/**
 * Estimate the bond's clean price from its last manual mark and the Treasury
 * curve move since the mark date. Duration comes from the mark itself, else
 * the holding, else 0 (price unchanged). Source is "mark" when the mark is
 * from today (Eastern) or curve data is missing; "estimate" otherwise.
 */
export function estimateBondPrice(
  h: Holding,
  lastMark: BondMark,
  curveAtMark: TreasuryCurvePoint[] | null,
  curveNow: TreasuryCurvePoint[] | null
): BondEstimate {
  const markPrice = Number(lastMark.clean_price);
  const markYtm = lastMark.ytm !== null && lastMark.ytm !== undefined ? Number(lastMark.ytm) : null;
  const markDuration =
    lastMark.duration !== null && lastMark.duration !== undefined
      ? Number(lastMark.duration)
      : h.duration !== null && h.duration !== undefined
        ? Number(h.duration)
        : null;

  const asMark: BondEstimate = {
    cleanPrice: markPrice,
    source: "mark",
    markedAt: lastMark.marked_at,
    ytm: markYtm,
    duration: markDuration,
  };

  const markedToday =
    easternDateString(new Date(lastMark.marked_at)) === easternDateString(new Date());
  if (markedToday) return asMark;

  const tenorYears = h.benchmark_tenor !== null ? Number(h.benchmark_tenor) : null;
  if (
    tenorYears === null ||
    !Number.isFinite(tenorYears) ||
    !curveAtMark ||
    curveAtMark.length === 0 ||
    !curveNow ||
    curveNow.length === 0
  ) {
    return asMark;
  }

  const yieldAtMark = interpolateYield(curveAtMark, tenorYears);
  const yieldNow = interpolateYield(curveNow, tenorYears);
  if (yieldAtMark === null || yieldNow === null) return asMark;

  const deltaPct = yieldNow - yieldAtMark; // percent, e.g. +0.25 for 25bp
  const deltaYield = deltaPct / 100; // decimal
  const duration = markDuration ?? 0;

  return {
    cleanPrice: markPrice * (1 - duration * deltaYield),
    source: "estimate",
    markedAt: lastMark.marked_at,
    // Assume the parallel shift moved the bond's yield with the benchmark.
    ytm: markYtm !== null ? markYtm + deltaPct : null,
    duration: markDuration,
  };
}
