// Parsing and date-matching for the historical snapshot import (SPEC 14).
//
// Pulled out of the route so it can be tested: fund_snapshots is the
// permanent record every performance number derives from, and a bad import is
// not something a student officer can unpick afterwards.

export interface SnapshotCsvRow {
  /** 1-based line in the file, for error messages. */
  line: number;
  date: string;
  totalValue: number;
  cash: number;
}

export interface SnapshotCsvResult {
  /** Valid rows, one per date, in date order. A repeated date keeps the last. */
  rows: SnapshotCsvRow[];
  errors: { row: number; message: string }[];
  /** Dates that appeared more than once, so the officer can be told. */
  duplicateDates: string[];
}

/** YYYY-MM-DD that is also a real calendar date, so 2026-02-30 is rejected. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/**
 * Validates already-split CSV cells. `header` is the lowercased header row;
 * `date` and `total_value` are required, `cash` optional.
 */
export function parseSnapshotRows(
  rows: string[][],
  header: string[]
): SnapshotCsvResult | { error: string } {
  const dateCol = header.indexOf("date");
  const totalCol = header.indexOf("total_value");
  const cashCol = header.indexOf("cash");
  if (dateCol === -1 || totalCol === -1) {
    return { error: "Header must include date and total_value (cash optional)." };
  }

  const errors: { row: number; message: string }[] = [];
  const byDate = new Map<string, SnapshotCsvRow>();
  const duplicates = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const line = i + 1;
    if (cells.every((c) => c.trim() === "")) continue; // blank line

    const date = (cells[dateCol] ?? "").trim();
    if (!isCalendarDate(date)) {
      errors.push({
        row: line,
        message: `"${date}" is not a date in YYYY-MM-DD form`,
      });
      continue;
    }

    // Spreadsheets export currency, so strip $ and thousands separators
    // before asking whether it is a number.
    const total = money(cells[totalCol]);
    if (total === null || total <= 0) {
      errors.push({
        row: line,
        message: `Bad total_value "${(cells[totalCol] ?? "").trim()}" on ${date}`,
      });
      continue;
    }
    const cash = cashCol >= 0 ? money(cells[cashCol]) ?? 0 : 0;
    if (cash < 0) {
      errors.push({ row: line, message: `Negative cash on ${date}` });
      continue;
    }
    if (cash > total) {
      // market_value is total - cash, and every weight derives from it.
      errors.push({
        row: line,
        message: `Cash (${cash}) is more than total_value (${total}) on ${date}`,
      });
      continue;
    }

    if (byDate.has(date)) duplicates.add(date);
    byDate.set(date, { line, date, totalValue: total, cash }); // last wins
  }

  return {
    rows: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    errors,
    duplicateDates: [...duplicates].sort(),
  };
}

/** "$4,500,000.00" -> 4500000, "" -> null. Parentheses mean negative. */
function money(raw: string | undefined): number | null {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  const negative = /^\(.*\)$/.test(text);
  const cleaned = text.replace(/[$,\s()]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export interface BenchmarkBar {
  close: number;
  adj: number | null;
}

/**
 * Matches each target date to the last benchmark bar on or before it, which
 * is what weekends, holidays and month-end NAV dates need. Both inputs are
 * sorted and walked once, so a nineteen-year import stays linear.
 *
 * A target earlier than every bar gets no match rather than the first one —
 * dating a 2007 NAV against a 2010 close would be a silent lie.
 */
export function matchBenchmarkBars(
  targetDates: string[],
  bars: Map<string, BenchmarkBar>
): Map<string, BenchmarkBar> {
  const barDates = [...bars.keys()].sort();
  const targets = [...targetDates].sort();
  const out = new Map<string, BenchmarkBar>();

  let i = 0;
  let carried: BenchmarkBar | null = null;
  for (const target of targets) {
    while (i < barDates.length && barDates[i] <= target) {
      carried = bars.get(barDates[i]) ?? carried;
      i++;
    }
    if (carried !== null) out.set(target, carried);
  }
  return out;
}
