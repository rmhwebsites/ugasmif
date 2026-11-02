/**
 * The pure half of the Athena import (scripts/import-athena-positions.ts):
 * check that a workbook book adds up, and work out what loading it would
 * change. No database access here, so the plan can be tested and printed as
 * a preview before anything is written.
 */

export interface Position {
  symbol: string;
  name: string;
  instrument_type: "equity" | "etf";
  /** Athena sector name, already mapped from the workbook's label. */
  sector: string;
  quantity: number;
  /** Cost per share. */
  avg_cost: number;
  opened_on: string | null;
  /** The workbook's own price and value on its as-of date, for the report. */
  price_now: number | null;
  value_now: number | null;
}

export interface SectorTarget {
  name: string;
  benchmark_weight_pct: number;
  /** The Equity Strategies team's over/underweight against the benchmark. */
  tilt_pct: number;
  target_weight_pct: number;
}

export interface Book {
  as_of: string;
  cash: number;
  sheet_total: number;
  positions: Position[];
  sector_targets: SectorTarget[];
}

/** A holdings row as the import reads it from the database. */
export interface ExistingHolding {
  id: string;
  symbol: string | null;
  name: string;
  instrument_type: string;
  quantity: number | string;
  avg_cost: number | string;
  opened_on: string | null;
  sector_id: string | null;
  is_active: boolean;
}

export interface HoldingRow {
  fund_id: string;
  sector_id: string;
  instrument_type: "equity" | "etf";
  symbol: string;
  name: string;
  quantity: number;
  avg_cost: number;
  opened_on: string | null;
  pricing_method: "live";
  is_active: true;
  closed_on: null;
}

export interface Plan {
  /** Matched positions whose row actually changes (reopened rows included). */
  updates: { id: string; row: HoldingRow; was: ExistingHolding }[];
  /** Matched positions already exactly as the workbook says. */
  unchanged: number;
  inserts: HoldingRow[];
  /** Active rows the workbook doesn't list, or a second row for a kept ticker. */
  close: ExistingHolding[];
}

export const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The book has to add up before anything is written; throws if it doesn't. */
export function checkBook(book: Book): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(book.as_of)) throw new Error("as_of must be YYYY-MM-DD");
  if (!(book.cash >= 0)) throw new Error("cash must be zero or more");
  const seen = new Set<string>();
  for (const p of book.positions) {
    const s = p.symbol.toUpperCase();
    if (!s) throw new Error("a position has no ticker");
    if (seen.has(s)) throw new Error(`duplicate ticker ${s}`);
    seen.add(s);
    if (!(p.quantity > 0) || !(p.avg_cost > 0)) {
      throw new Error(`${s}: shares and cost must be positive`);
    }
  }
  const value = book.cash + book.positions.reduce((sum, p) => sum + (p.value_now ?? 0), 0);
  if (Math.abs(value - book.sheet_total) > 0.01) {
    throw new Error(
      `positions + cash ${money(value)} != the sheet's TOTAL ${money(book.sheet_total)}`
    );
  }
}

/**
 * What loading `book` into a fund holding `existing` would do. Positions are
 * matched on ticker and keep their row id; a ticker with several rows reuses
 * the active one first, and the rest are closed so nothing is counted twice.
 */
export function planImport(
  book: Book,
  existing: ExistingHolding[],
  fundId: string,
  sectorIdByName: Map<string, string>
): Plan {
  const ordered = [...existing].sort((a, b) => Number(b.is_active) - Number(a.is_active));
  const byTicker = new Map<string, ExistingHolding>();
  for (const h of ordered) {
    const t = (h.symbol ?? "").toUpperCase();
    if (t && !byTicker.has(t)) byTicker.set(t, h);
  }

  const updates: Plan["updates"] = [];
  const inserts: HoldingRow[] = [];
  const kept = new Set<string>();
  let unchanged = 0;
  for (const p of book.positions) {
    const sectorId = sectorIdByName.get(p.sector.toLowerCase());
    if (!sectorId) throw new Error(`no sector named ${p.sector}`);
    const row: HoldingRow = {
      fund_id: fundId,
      sector_id: sectorId,
      instrument_type: p.instrument_type,
      symbol: p.symbol.toUpperCase(),
      name: p.name,
      quantity: p.quantity,
      avg_cost: p.avg_cost,
      opened_on: p.opened_on,
      pricing_method: "live",
      is_active: true,
      closed_on: null,
    };
    const was = byTicker.get(row.symbol);
    if (!was) {
      inserts.push(row);
      continue;
    }
    kept.add(was.id);
    const same =
      was.is_active &&
      Number(was.quantity) === row.quantity &&
      Number(was.avg_cost) === row.avg_cost &&
      was.opened_on === row.opened_on &&
      was.sector_id === row.sector_id &&
      was.name === row.name &&
      was.instrument_type === row.instrument_type;
    if (same) unchanged++;
    else updates.push({ id: was.id, row, was });
  }

  const close = ordered.filter((h) => h.is_active && !kept.has(h.id));
  return { updates, unchanged, inserts, close };
}
