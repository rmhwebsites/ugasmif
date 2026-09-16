// Performance math off fund_snapshots (SPEC Section 14). Pure functions —
// no I/O — so every one of them is unit-testable with synthetic snapshots.
//
// Daily time-weighted return:  r_t = (V_t − CF_t) / V_{t−1} − 1, chain-linked,
// where CF_t is the signed sum of cash_movements of kind contribution /
// withdrawal dated that day (external flows; dividends and coupons are
// internal and stay in the return). Benchmark returns come from
// benchmark_adj_close, falling back to benchmark_close when adjusted is
// missing. All returned return/percent values are in PERCENT (e.g. 2.5 for
// +2.5%) so callers can hand them straight to formatPercent/formatSignedPercent.
//
// Dates are treated as plain "YYYY-MM-DD" strings (lexicographic order ==
// chronological order) to stay timezone-proof.

import type { CashMovement, ChartPoint, FundSnapshot } from "@/types/domain";

export interface PeriodReturn {
  label: string;
  fund: number | null;
  benchmark: number | null;
  diff: number | null;
}

const MS_PER_DAY = 86_400_000;
const TRADING_DAYS_PER_YEAR = 252;
const DEFAULT_PERIODS = ["MTD", "QTD", "YTD", "LTM", "3Y", "SI"];

interface DailyReturn {
  date: string; // date of V_t
  r: number; // decimal return
}

/** Sort ascending by snapshot_date; when a date repeats, the last row wins. */
function sortSnapshots(snapshots: FundSnapshot[]): FundSnapshot[] {
  const byDate = new Map<string, FundSnapshot>();
  for (const s of [...snapshots].sort((a, b) =>
    a.snapshot_date.localeCompare(b.snapshot_date)
  )) {
    byDate.set(s.snapshot_date.slice(0, 10), s);
  }
  return [...byDate.values()];
}

/** Signed external flow (contribution/withdrawal) per YYYY-MM-DD. */
function flowsByDate(flows: CashMovement[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of flows) {
    if (f.kind !== "contribution" && f.kind !== "withdrawal") continue;
    const date = f.occurred_on.slice(0, 10);
    const amount = Number(f.amount);
    if (!Number.isFinite(amount)) continue;
    out.set(date, (out.get(date) ?? 0) + amount);
  }
  return out;
}

/** Flow-adjusted daily fund returns from sorted snapshots. */
function fundDailyReturns(
  sorted: FundSnapshot[],
  flows: CashMovement[]
): DailyReturn[] {
  const cf = flowsByDate(flows);
  const out: DailyReturn[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = Number(sorted[i - 1].total_value);
    const curr = Number(sorted[i].total_value);
    if (!(prev > 0) || !Number.isFinite(curr)) continue;
    const date = sorted[i].snapshot_date.slice(0, 10);
    const flow = cf.get(date) ?? 0;
    out.push({ date, r: (curr - flow) / prev - 1 });
  }
  return out;
}

function benchmarkPrice(s: FundSnapshot): number | null {
  const adj = s.benchmark_adj_close !== null ? Number(s.benchmark_adj_close) : null;
  if (adj !== null && Number.isFinite(adj) && adj > 0) return adj;
  const close = s.benchmark_close !== null ? Number(s.benchmark_close) : null;
  return close !== null && Number.isFinite(close) && close > 0 ? close : null;
}

/** Benchmark daily returns between consecutive snapshots that carry a price. */
function benchmarkDailyReturns(sorted: FundSnapshot[]): DailyReturn[] {
  const out: DailyReturn[] = [];
  let prev: number | null = null;
  for (const s of sorted) {
    const price = benchmarkPrice(s);
    if (price === null) continue;
    if (prev !== null) {
      out.push({ date: s.snapshot_date.slice(0, 10), r: price / prev - 1 });
    }
    prev = price;
  }
  return out;
}

/** Chain-link: Π(1 + r) − 1, or null when the window holds no returns. */
function chain(returns: DailyReturn[]): number | null {
  if (returns.length === 0) return null;
  return returns.reduce((g, { r }) => g * (1 + r), 1) - 1;
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS_PER_DAY;
}

/** `date` shifted back `n` years (Feb 29 clamps to Feb 28). */
function yearsAgo(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = m === 2 && d === 29 ? 28 : d;
  return `${String(y - n).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Inclusive start date of a period window anchored at the LAST snapshot date
 * (returns dated >= start are chained). "SI" and unknown labels return null
 * meaning "everything"; LTM/3Y windows are (anchor − N years, anchor].
 */
function periodStart(label: string, lastDate: string): string | null {
  const [y, m] = lastDate.split("-").map(Number);
  const pad = (v: number) => String(v).padStart(2, "0");
  switch (label) {
    case "MTD":
      return `${y}-${pad(m)}-01`;
    case "QTD": {
      const qMonth = Math.floor((m - 1) / 3) * 3 + 1;
      return `${y}-${pad(qMonth)}-01`;
    }
    case "YTD":
      return `${y}-01-01`;
    case "LTM":
      return yearsAgo(lastDate, 1);
    case "3Y":
      return yearsAgo(lastDate, 3);
    default:
      return null; // SI and anything unrecognized: since inception
  }
}

function inWindow(returns: DailyReturn[], label: string, lastDate: string): DailyReturn[] {
  const start = periodStart(label, lastDate);
  if (start === null) return returns;
  // Anniversary windows exclude the anchor date itself; calendar windows
  // include every return dated inside the calendar period.
  const exclusive = label === "LTM" || label === "3Y";
  return returns.filter(({ date }) => (exclusive ? date > start : date >= start));
}

/**
 * Period returns (percent) for the newsletter table: fund vs benchmark and
 * the difference. 3Y is annualized by actual elapsed days of the window; a 3Y
 * cell is null until the history actually spans three years. Null cells mean
 * "not enough snapshots yet".
 */
export function timeWeightedReturns(
  snapshots: FundSnapshot[],
  flows: CashMovement[],
  periods: string[] = DEFAULT_PERIODS
): PeriodReturn[] {
  const sorted = sortSnapshots(snapshots);
  if (sorted.length < 2) {
    return periods.map((label) => ({ label, fund: null, benchmark: null, diff: null }));
  }
  const lastDate = sorted[sorted.length - 1].snapshot_date.slice(0, 10);
  const firstDate = sorted[0].snapshot_date.slice(0, 10);
  const fundReturns = fundDailyReturns(sorted, flows);
  const benchReturns = benchmarkDailyReturns(sorted);

  return periods.map((label) => {
    let fund = chain(inWindow(fundReturns, label, lastDate));
    let benchmark = chain(inWindow(benchReturns, label, lastDate));

    if (label === "3Y") {
      const start = yearsAgo(lastDate, 3);
      if (firstDate > start) {
        // History does not span three years — no annualized figure yet.
        fund = null;
        benchmark = null;
      } else {
        const years = Math.max(daysBetween(start, lastDate), 1) / 365.25;
        fund = fund !== null ? Math.pow(1 + fund, 1 / years) - 1 : null;
        benchmark = benchmark !== null ? Math.pow(1 + benchmark, 1 / years) - 1 : null;
      }
    }

    const fundPct = fund !== null ? fund * 100 : null;
    const benchPct = benchmark !== null ? benchmark * 100 : null;
    return {
      label,
      fund: fundPct,
      benchmark: benchPct,
      diff: fundPct !== null && benchPct !== null ? fundPct - benchPct : null,
    };
  });
}

/**
 * Cumulative growth of $1 in the fund, flow-adjusted and chain-linked. The
 * first snapshot anchors at 1.00; one point per snapshot date.
 */
export function dailyReturnSeries(
  snapshots: FundSnapshot[],
  flows: CashMovement[]
): ChartPoint[] {
  const sorted = sortSnapshots(snapshots);
  if (sorted.length === 0) return [];
  const cf = flowsByDate(flows);

  const points: ChartPoint[] = [
    { time: sorted[0].snapshot_date.slice(0, 10), value: 1 },
  ];
  let growth = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = Number(sorted[i - 1].total_value);
    const curr = Number(sorted[i].total_value);
    const date = sorted[i].snapshot_date.slice(0, 10);
    if (prev > 0 && Number.isFinite(curr)) {
      const flow = cf.get(date) ?? 0;
      growth *= (curr - flow) / prev;
    }
    points.push({ time: date, value: growth });
  }
  return points;
}

/**
 * Cumulative growth of $1 in the benchmark from benchmark_adj_close (fallback
 * benchmark_close). Snapshots without a benchmark price are skipped, so the
 * series stays chain-consistent across gaps.
 */
export function benchmarkReturnSeries(snapshots: FundSnapshot[]): ChartPoint[] {
  const sorted = sortSnapshots(snapshots);
  const points: ChartPoint[] = [];
  let base: number | null = null;
  for (const s of sorted) {
    const price = benchmarkPrice(s);
    if (price === null) continue;
    if (base === null) base = price;
    points.push({ time: s.snapshot_date.slice(0, 10), value: price / base });
  }
  return points;
}

/**
 * Percent drawdown from the running peak at each point (0 at peaks, negative
 * underwater — e.g. −25 for a fall to 75% of the prior high). Feed it the
 * output of dailyReturnSeries or benchmarkReturnSeries.
 */
export function drawdownSeries(points: ChartPoint[]): ChartPoint[] {
  let peak = -Infinity;
  return points.map((p) => {
    if (p.value > peak) peak = p.value;
    return { time: p.time, value: peak > 0 ? (p.value / peak - 1) * 100 : 0 };
  });
}

/**
 * Calendar-year table of monthly chained returns (percent): one row per year,
 * months[0..11] = Jan..Dec (null when the month has no returns), total = the
 * year's chained return. Rows are ordered newest year first.
 */
export function monthlyReturnTable(
  snapshots: FundSnapshot[],
  flows: CashMovement[]
): { year: number; months: (number | null)[]; total: number | null }[] {
  const sorted = sortSnapshots(snapshots);
  const returns = fundDailyReturns(sorted, flows);

  const byYear = new Map<number, DailyReturn[][]>(); // year → 12 buckets
  for (const ret of returns) {
    const year = Number(ret.date.slice(0, 4));
    const monthIdx = Number(ret.date.slice(5, 7)) - 1;
    let buckets = byYear.get(year);
    if (!buckets) {
      buckets = Array.from({ length: 12 }, () => []);
      byYear.set(year, buckets);
    }
    buckets[monthIdx].push(ret);
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, buckets]) => {
      const months = buckets.map((bucket) => {
        const linked = chain(bucket);
        return linked !== null ? linked * 100 : null;
      });
      const yearLinked = chain(buckets.flat());
      return { year, months, total: yearLinked !== null ? yearLinked * 100 : null };
    });
}

/**
 * Risk metrics from daily snapshot returns (ported from GBH risk.ts):
 * annualized volatility (percent, √252 scaling), max drawdown (positive
 * percent), and beta vs the benchmark's daily returns (cov/var; null when
 * benchmark data is missing or flat). Returns null with fewer than 20
 * snapshots — anything less is noise. Pass `flows` (optional, compatible
 * extension) to flow-adjust the fund returns; without it, raw total_value
 * returns are used.
 */
export function riskMetrics(
  snapshots: FundSnapshot[],
  flows: CashMovement[] = []
): { volatility: number; maxDrawdown: number; beta: number | null; top5Weight?: number } | null {
  if (snapshots.length < 20) return null;
  const sorted = sortSnapshots(snapshots);
  if (sorted.length < 20) return null;

  const fundReturns = fundDailyReturns(sorted, flows);
  if (fundReturns.length < 2) return null;
  const rs = fundReturns.map(({ r }) => r);

  const mean = rs.reduce((s, r) => s + r, 0) / rs.length;
  const variance = rs.reduce((s, r) => s + (r - mean) ** 2, 0) / (rs.length - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;

  // Max drawdown off the flow-adjusted growth series.
  let peak = -Infinity;
  let maxDrawdown = 0;
  for (const p of dailyReturnSeries(sorted, flows)) {
    if (p.value > peak) peak = p.value;
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (1 - p.value / peak) * 100);
  }

  // Beta: pair fund and benchmark returns by date.
  const benchByDate = new Map(
    benchmarkDailyReturns(sorted).map(({ date, r }) => [date, r])
  );
  const pairs = fundReturns
    .filter(({ date }) => benchByDate.has(date))
    .map(({ date, r }) => ({ f: r, b: benchByDate.get(date) as number }));
  let beta: number | null = null;
  if (pairs.length >= 2) {
    const fMean = pairs.reduce((s, p) => s + p.f, 0) / pairs.length;
    const bMean = pairs.reduce((s, p) => s + p.b, 0) / pairs.length;
    const cov =
      pairs.reduce((s, p) => s + (p.f - fMean) * (p.b - bMean), 0) / (pairs.length - 1);
    const bVar =
      pairs.reduce((s, p) => s + (p.b - bMean) ** 2, 0) / (pairs.length - 1);
    beta = bVar > 0 ? cov / bVar : null;
  }

  return { volatility, maxDrawdown, beta };
}
