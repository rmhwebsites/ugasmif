// The historical snapshot import (SPEC 14). fund_snapshots is the permanent
// record every performance number derives from, and the officers will load
// nineteen years of NAVs through this once, from a spreadsheet, so the
// parsing has to be strict and the date matching has to be honest.

import { describe, it, expect } from "vitest";
import {
  isCalendarDate,
  matchBenchmarkBars,
  parseSnapshotRows,
  type BenchmarkBar,
} from "@/lib/snapshots";

const HEADER = ["date", "total_value", "cash"];

function parse(body: string[][]) {
  const result = parseSnapshotRows([HEADER, ...body], HEADER);
  if ("error" in result) throw new Error(result.error);
  return result;
}

describe("isCalendarDate", () => {
  it("accepts a real date", () => {
    expect(isCalendarDate("2026-09-16")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects a date that does not exist", () => {
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2023-02-29")).toBe(false); // not a leap year
    expect(isCalendarDate("2026-13-01")).toBe(false);
  });

  it("rejects other formats", () => {
    expect(isCalendarDate("09/16/2026")).toBe(false);
    expect(isCalendarDate("2026-9-16")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("parseSnapshotRows", () => {
  it("refuses a header without the required columns", () => {
    expect(parseSnapshotRows([["date"]], ["date"])).toEqual({
      error: "Header must include date and total_value (cash optional).",
    });
  });

  it("reads plain rows in date order", () => {
    const { rows, errors } = parse([
      ["2026-09-02", "4500000", "22500"],
      ["2026-09-01", "4400000", "20000"],
    ]);
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(rows[1]).toMatchObject({ totalValue: 4_500_000, cash: 22_500 });
  });

  it("reads the currency formatting a spreadsheet exports", () => {
    // parseCsv has already unquoted the cells by the time they arrive here.
    const { rows, errors } = parse([["2026-09-01", "$4,500,000.00", "$22,500"]]);
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ totalValue: 4_500_000, cash: 22_500 });
  });

  it("keeps the last row when a date repeats, and says so", () => {
    const { rows, duplicateDates } = parse([
      ["2026-09-01", "100", "0"],
      ["2026-09-01", "200", "0"],
    ]);
    // Postgres rejects an ON CONFLICT batch that touches a row twice, so this
    // has to be resolved before the upsert, not by the database.
    expect(rows).toHaveLength(1);
    expect(rows[0].totalValue).toBe(200);
    expect(duplicateDates).toEqual(["2026-09-01"]);
  });

  it("rejects a total that is zero, negative or not a number", () => {
    const { rows, errors } = parse([
      ["2026-09-01", "0", "0"],
      ["2026-09-02", "-5", "0"],
      ["2026-09-03", "n/a", "0"],
      ["2026-09-04", "", "0"],
    ]);
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(4);
    expect(errors[0].row).toBe(2); // 1-based, header is line 1
  });

  it("rejects cash larger than the total", () => {
    // market_value would go negative, and every weight computed from it.
    const { rows, errors } = parse([["2026-09-01", "1000", "2000"]]);
    expect(rows).toEqual([]);
    expect(errors[0].message).toContain("more than total_value");
  });

  it("treats a missing cash cell as zero", () => {
    const result = parseSnapshotRows(
      [["date", "total_value"], ["2026-09-01", "1000"]],
      ["date", "total_value"]
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.rows[0]).toMatchObject({ totalValue: 1000, cash: 0 });
  });

  it("skips blank lines without calling them errors", () => {
    const { rows, errors } = parse([
      ["2026-09-01", "1000", "0"],
      ["", "", ""],
      ["   ", "", ""],
    ]);
    expect(rows).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it("keeps the good rows when some are bad", () => {
    const { rows, errors } = parse([
      ["2026-09-01", "1000", "0"],
      ["not-a-date", "1000", "0"],
      ["2026-09-03", "1200", "0"],
    ]);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-03"]);
    expect(errors).toHaveLength(1);
  });
});

describe("matchBenchmarkBars", () => {
  const bars = new Map<string, BenchmarkBar>([
    ["2026-09-01", { close: 100, adj: 99 }],
    ["2026-09-02", { close: 101, adj: 100 }],
    ["2026-09-04", { close: 103, adj: 102 }],
  ]);

  it("matches an exact date", () => {
    const out = matchBenchmarkBars(["2026-09-02"], bars);
    expect(out.get("2026-09-02")).toEqual({ close: 101, adj: 100 });
  });

  it("carries the last close forward over a weekend or holiday", () => {
    // Sep 3 has no bar; the fund's NAV that day compares to Sep 2's close.
    const out = matchBenchmarkBars(["2026-09-03"], bars);
    expect(out.get("2026-09-03")).toEqual({ close: 101, adj: 100 });
  });

  it("gives no match to a date before every bar", () => {
    // Dating a 2007 NAV against a 2010 close would be a silent lie.
    const out = matchBenchmarkBars(["2026-08-31"], bars);
    expect(out.has("2026-08-31")).toBe(false);
  });

  it("carries the final close forward past the last bar", () => {
    const out = matchBenchmarkBars(["2026-09-10"], bars);
    expect(out.get("2026-09-10")).toEqual({ close: 103, adj: 102 });
  });

  it("handles unsorted targets and many dates in one pass", () => {
    const out = matchBenchmarkBars(
      ["2026-09-04", "2026-08-31", "2026-09-03", "2026-09-01"],
      bars
    );
    expect(out.get("2026-09-01")?.close).toBe(100);
    expect(out.get("2026-09-03")?.close).toBe(101);
    expect(out.get("2026-09-04")?.close).toBe(103);
    expect(out.has("2026-08-31")).toBe(false);
  });

  it("returns nothing when there are no bars", () => {
    expect(matchBenchmarkBars(["2026-09-01"], new Map()).size).toBe(0);
  });
});
