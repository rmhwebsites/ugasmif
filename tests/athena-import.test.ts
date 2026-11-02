// Loading the Athena book from the PM's workbook (scripts/import-athena-positions.ts)
// writes to a live fund, so the plan it previews is tested here: positions
// keep their row when the ticker matches, everything the workbook doesn't
// list is closed (never deleted), and a second run changes nothing.

import { describe, it, expect } from "vitest";
import {
  checkBook,
  planImport,
  type Book,
  type ExistingHolding,
  type Position,
} from "../scripts/athena-book";

const SECTORS = new Map([
  ["technology", "sec-tech"],
  ["healthcare", "sec-hc"],
]);

function pos(symbol: string, qty: number, cost: number, extra: Partial<Position> = {}): Position {
  return {
    symbol,
    name: symbol,
    instrument_type: "equity",
    sector: "Technology",
    quantity: qty,
    avg_cost: cost,
    opened_on: "2024-01-02",
    price_now: 10,
    value_now: qty * 10,
    ...extra,
  };
}

function book(positions: Position[], cash = 100): Book {
  return {
    as_of: "2026-10-27",
    cash,
    sheet_total: cash + positions.reduce((s, p) => s + (p.value_now ?? 0), 0),
    positions,
    sector_targets: [],
  };
}

function held(id: string, symbol: string | null, qty: number, cost: number, extra: Partial<ExistingHolding> = {}): ExistingHolding {
  return {
    id,
    symbol,
    name: symbol ?? "Sweep",
    instrument_type: "equity",
    quantity: String(qty), // numeric columns arrive as strings
    avg_cost: String(cost),
    opened_on: "2024-01-02",
    sector_id: "sec-tech",
    is_active: true,
    ...extra,
  };
}

describe("checkBook", () => {
  it("accepts a book that adds up to the sheet's total", () => {
    expect(() => checkBook(book([pos("AAA", 10, 5), pos("BBB", 2, 7)]))).not.toThrow();
  });

  it("refuses a book that doesn't add up", () => {
    const b = book([pos("AAA", 10, 5)]);
    b.sheet_total += 1;
    expect(() => checkBook(b)).toThrow(/TOTAL/);
  });

  it("refuses a ticker listed twice", () => {
    expect(() => checkBook(book([pos("AAA", 10, 5), pos("aaa", 1, 5)]))).toThrow(/duplicate/);
  });

  it("refuses zero shares or zero cost", () => {
    expect(() => checkBook(book([pos("AAA", 0, 5, { value_now: 0 })]))).toThrow(/positive/);
    expect(() => checkBook(book([pos("AAA", 10, 0)]))).toThrow(/positive/);
  });
});

describe("planImport", () => {
  it("updates a matched ticker in place, adds new ones, closes the rest", () => {
    const plan = planImport(
      book([pos("AAA", 120, 50), pos("BBB", 30, 200)]),
      [held("h-aaa", "AAA", 50, 40), held("h-zzz", "ZZZ", 300, 30), held("h-sweep", null, 1, 1)],
      "fund",
      SECTORS
    );
    expect(plan.updates.map((u) => [u.id, u.row.quantity, u.row.avg_cost])).toEqual([
      ["h-aaa", 120, 50],
    ]);
    expect(plan.inserts.map((r) => r.symbol)).toEqual(["BBB"]);
    expect(plan.close.map((h) => h.id).sort()).toEqual(["h-sweep", "h-zzz"]);
  });

  it("changes nothing when the database already matches the workbook", () => {
    const plan = planImport(
      book([pos("AAA", 120, 50)]),
      [held("h-aaa", "AAA", 120, 50)],
      "fund",
      SECTORS
    );
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.close).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("reopens a closed row for a ticker that is back instead of adding a second", () => {
    const plan = planImport(
      book([pos("CCC", 40, 75)]),
      [held("h-ccc", "CCC", 90, 60, { is_active: false })],
      "fund",
      SECTORS
    );
    expect(plan.updates.map((u) => u.id)).toEqual(["h-ccc"]);
    expect(plan.updates[0].row.is_active).toBe(true);
    expect(plan.inserts).toEqual([]);
  });

  it("keeps the active row of a ticker held twice and closes the other", () => {
    const plan = planImport(
      book([pos("DDD", 15, 400)]),
      [
        held("h-old", "DDD", 10, 1, { is_active: false }),
        held("h-a", "DDD", 20, 380),
        held("h-b", "DDD", 5, 600),
      ],
      "fund",
      SECTORS
    );
    expect(plan.updates.map((u) => u.id)).toEqual(["h-a"]);
    expect(plan.close.map((h) => h.id)).toEqual(["h-b"]);
  });

  it("matches tickers without regard to case and moves a row to its new sector", () => {
    const plan = planImport(
      book([pos("eee", 25, 100, { sector: "Healthcare" })]),
      [held("h-eee", "EEE", 25, 100)],
      "fund",
      SECTORS
    );
    expect(plan.updates.map((u) => [u.id, u.row.symbol, u.row.sector_id])).toEqual([
      ["h-eee", "EEE", "sec-hc"],
    ]);
  });

  it("refuses a sector the fund doesn't have", () => {
    expect(() =>
      planImport(book([pos("FFF", 1, 1, { sector: "Energy" })]), [], "fund", SECTORS)
    ).toThrow(/no sector named Energy/);
  });
});
