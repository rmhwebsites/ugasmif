// The comparison every sortable table runs on (SPEC 11.4).

import { describe, it, expect } from "vitest";
import { sortByValue } from "@/lib/sort";

interface Row {
  name: string;
  qty: number;
  maturity: string | null;
}

const rows: Row[] = [
  { name: "NVDA", qty: 100, maturity: null },
  { name: "AAPL", qty: 20, maturity: null },
  { name: "T 4.25 2034", qty: 50_000, maturity: "2034-11-15" },
  { name: "T 2.00 2028", qty: 5_000, maturity: "2028-02-15" },
];

const names = (out: Row[]) => out.map((r) => r.name);

describe("sortByValue", () => {
  it("sorts numbers numerically, not lexically", () => {
    expect(names(sortByValue(rows, (r) => r.qty, "asc"))).toEqual([
      "AAPL",
      "NVDA",
      "T 2.00 2028",
      "T 4.25 2034",
    ]);
    // 100 before 20 would be the string answer, and wrong.
    expect(names(sortByValue(rows, (r) => r.qty, "desc"))).toEqual([
      "T 4.25 2034",
      "T 2.00 2028",
      "NVDA",
      "AAPL",
    ]);
  });

  it("sorts strings with localeCompare", () => {
    expect(names(sortByValue(rows, (r) => r.name, "asc"))).toEqual([
      "AAPL",
      "NVDA",
      "T 2.00 2028",
      "T 4.25 2034",
    ]);
  });

  it("keeps blanks last in BOTH directions", () => {
    // The whole point: a bond fund sorted by maturity must not open with a
    // screenful of equities that have none, and reversing must not either.
    const asc = sortByValue(rows, (r) => r.maturity, "asc");
    expect(names(asc)).toEqual(["T 2.00 2028", "T 4.25 2034", "NVDA", "AAPL"]);

    const desc = sortByValue(rows, (r) => r.maturity, "desc");
    expect(names(desc)).toEqual(["T 4.25 2034", "T 2.00 2028", "NVDA", "AAPL"]);
  });

  it("treats the empty string as blank, like null", () => {
    const withEmpty = [
      { name: "a", qty: 1, maturity: "" },
      { name: "b", qty: 2, maturity: "2030-01-01" },
    ];
    expect(names(sortByValue(withEmpty, (r) => r.maturity, "asc"))).toEqual([
      "b",
      "a",
    ]);
  });

  it("does not mutate the input", () => {
    const before = names(rows);
    sortByValue(rows, (r) => r.qty, "desc");
    expect(names(rows)).toEqual(before);
  });

  it("handles zero as a value, not a blank", () => {
    const withZero = [
      { name: "none", qty: 0, maturity: null },
      { name: "some", qty: 5, maturity: null },
    ];
    expect(names(sortByValue(withZero, (r) => r.qty, "asc"))).toEqual([
      "none",
      "some",
    ]);
  });

  it("returns an empty array unchanged", () => {
    expect(sortByValue([], (r: Row) => r.qty, "asc")).toEqual([]);
  });
});
