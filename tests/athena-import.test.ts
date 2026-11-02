// Loading the Athena book from the PM's workbook (scripts/import-athena-positions.ts)
// writes to a live fund, so the plan it previews is tested here: positions
// keep their row when the ticker matches, everything the workbook doesn't
// list is closed (never deleted), and a second run changes nothing.

import { describe, it, expect } from "vitest";
import {
  checkBook,
  cleanCompanyName,
  historySnapshots,
  planDemoCleanup,
  planImport,
  resolveIdentity,
  type DemoTables,
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

describe("cleanCompanyName", () => {
  it("drops the corporate suffix Yahoo carries", () => {
    expect(cleanCompanyName("Amgen Inc.")).toBe("Amgen");
    expect(cleanCompanyName("Eaton Corporation, PLC")).toBe("Eaton");
    expect(cleanCompanyName("Goldman Sachs Group, Inc. (The)")).toBe("Goldman Sachs Group");
    expect(cleanCompanyName("ASML Holding N.V. - New York Registry Shares")).toBe("ASML Holding");
    expect(cleanCompanyName("Garmin Ltd.")).toBe("Garmin");
  });

  it("keeps Company, which is part of the name", () => {
    expect(cleanCompanyName("Southern Company (The)")).toBe("Southern Company");
    expect(cleanCompanyName("Coca-Cola Company (The)")).toBe("Coca-Cola Company");
    expect(cleanCompanyName("The TJX Companies, Inc.")).toBe("TJX Companies");
  });
});

describe("resolveIdentity", () => {
  const unnamed = (symbol: string): Position => pos(symbol, 1, 1, { name: null, instrument_type: null });

  it("keeps the name and type on a row the fund already holds", () => {
    const [p] = resolveIdentity(
      [unnamed("aaa")],
      [held("h-aaa", "AAA", 1, 1, { name: "Officer's name", instrument_type: "etf" })],
      new Map([["AAA", { name: "Quote Name Inc.", quoteType: "EQUITY" }]])
    );
    expect([p.symbol, p.name, p.instrument_type]).toEqual(["AAA", "Officer's name", "etf"]);
  });

  it("names a new ticker from its quote and reads ETFs off the quote type", () => {
    const [a, b] = resolveIdentity(
      [unnamed("NEW"), unnamed("FUND")],
      [],
      new Map([
        ["NEW", { name: "New Company Holdings Inc.", quoteType: "EQUITY" }],
        ["FUND", { name: "Some Sector ETF", quoteType: "ETF" }],
      ])
    );
    expect([a.name, a.instrument_type]).toEqual(["New Company Holdings", "equity"]);
    expect([b.name, b.instrument_type]).toEqual(["Some Sector ETF", "etf"]);
  });

  it("uses a name the extractor already gave", () => {
    const [p] = resolveIdentity([pos("AAA", 1, 1, { name: "Given" })], [], new Map());
    expect(p.name).toBe("Given");
  });

  it("stops on a ticker nothing can name", () => {
    expect(() => resolveIdentity([unnamed("ZZZZ")], [], new Map())).toThrow(/ZZZZ/);
  });
});

describe("planDemoCleanup", () => {
  const DEMO = new Set(["demo-analyst", "demo-pm"]);
  const tables = (over: Partial<DemoTables> = {}): DemoTables => ({
    pitches: [
      { id: "p-demo", author_id: "demo-analyst", title: "Demo pitch" },
      { id: "p-real", author_id: "real-member", title: "A member's real pitch" },
    ],
    tickets: [{ id: "k-demo", created_by: "demo-analyst", pitch_id: "p-demo" }],
    trades: [
      // Seeded under a real admin account: the note is what marks it.
      { id: "t-seed", executed_by: "real-admin", ticket_id: null, notes: "Seed: Q3 trim" },
      { id: "t-ticket", executed_by: "real-admin", ticket_id: "k-demo", notes: null },
      { id: "t-real", executed_by: "real-admin", ticket_id: null, notes: "Bought on the 4th" },
    ],
    cashMovements: [
      { id: "c-demo", recorded_by: "demo-pm", holding_id: null },
      { id: "c-real", recorded_by: "real-admin", holding_id: null },
    ],
    holdings: [
      { id: "h-placeholder", symbol: "ZZZ", name: "Placeholder", is_active: false },
      { id: "h-closed-real", symbol: "YYY", name: "Sold for real", is_active: false },
      { id: "h-live", symbol: "AAA", name: "Held", is_active: true },
    ],
    otherHoldingRefs: [],
    holdingRefs: [
      { table: "trades", id: "t-seed", holding_id: "h-placeholder" },
      { table: "trades", id: "t-real", holding_id: "h-closed-real" },
    ],
    ...over,
  });

  it("removes demo pitches, their tickets and trades, seeded trades and demo cash", () => {
    const plan = planDemoCleanup(tables(), DEMO);
    expect(plan.pitches).toEqual(["p-demo"]);
    expect(plan.tickets).toEqual(["k-demo"]);
    expect(plan.trades.sort()).toEqual(["t-seed", "t-ticket"]);
    expect(plan.cashMovements).toEqual(["c-demo"]);
  });

  it("keeps and reports anything that isn't demo", () => {
    const plan = planDemoCleanup(tables(), DEMO);
    expect(plan.kept.map((k) => k.id).sort()).toEqual(["c-real", "p-real", "t-real"]);
  });

  it("deletes a closed holding only once nothing real points at it", () => {
    const plan = planDemoCleanup(tables(), DEMO);
    // The placeholder's only trade was seed data; the real sale keeps its holding.
    expect(plan.holdings).toEqual(["h-placeholder"]);
  });

  it("never deletes an active holding or one with bond marks", () => {
    const plan = planDemoCleanup(tables({ otherHoldingRefs: ["h-placeholder"] }), DEMO);
    expect(plan.holdings).toEqual([]);
  });

  it("treats a ticket on a demo pitch as demo, whoever opened it", () => {
    const plan = planDemoCleanup(
      tables({ tickets: [{ id: "k-on-demo", created_by: "real-admin", pitch_id: "p-demo" }] }),
      DEMO
    );
    expect(plan.tickets).toEqual(["k-on-demo"]);
  });
});

describe("historySnapshots", () => {
  const history = [
    { date: "2026-03-31", total_value: 4_000_000, benchmark_level: 6500 },
    { date: "2026-04-30", total_value: 4_400_000, benchmark_level: 6500 },
  ];

  it("writes month-ends the way the app's history import does", () => {
    const rows = historySnapshots(
      "fund",
      "^GSPC",
      history,
      new Map([["2026-03-31", { close: 6528.5, adj: 6528.5 }]])
    );
    expect(rows[0]).toMatchObject({
      snapshot_date: "2026-03-31",
      total_value: 4_000_000,
      market_value: 4_000_000,
      cash: 0,
      benchmark_symbol: "^GSPC",
      benchmark_close: 6528.5,
      detail: { imported: true },
    });
    // No Yahoo bar for that date: the fund value still goes in, unbenchmarked.
    expect(rows[1].benchmark_close).toBeNull();
  });

  it("refuses dates out of order and months with no value", () => {
    expect(() => historySnapshots("f", "^GSPC", [...history].reverse(), new Map())).toThrow(/order/);
    expect(() =>
      historySnapshots("f", "^GSPC", [{ date: "2026-03-31", total_value: 0, benchmark_level: null }], new Map())
    ).toThrow(/no portfolio value/);
  });
});
