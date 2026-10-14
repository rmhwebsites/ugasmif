// Dates on the page (SPEC 11). A Postgres `date` column arrives as a bare
// 'YYYY-MM-DD' with no time and no zone, and converting it to Eastern moves it
// back a day — the Arch calendar's Monday sessions all rendered as Sundays.

import { describe, it, expect } from "vitest";
import { formatDate, formatDateTime, formatDay } from "@/lib/format";

describe("formatDate", () => {
  it("renders a bare calendar date as itself, not the day before", () => {
    // 2026-08-17 is a Monday; the class meets Mondays.
    expect(formatDate("2026-08-17")).toBe("Aug 17, 2026");
    expect(formatDate("2026-11-30")).toBe("Nov 30, 2026");
  });

  it("holds the date across a month and a year boundary", () => {
    expect(formatDate("2037-04-01")).toBe("Apr 1, 2037");
    expect(formatDate("2031-01-01")).toBe("Jan 1, 2031");
  });

  it("still converts a real instant into Eastern", () => {
    // 04:30 UTC is the previous evening in New York, and should say so.
    expect(formatDate("2026-08-18T04:30:00Z")).toBe("Aug 18, 2026");
    expect(formatDate("2026-08-18T01:30:00Z")).toBe("Aug 17, 2026");
  });

  it("has nothing to say about a missing or unparseable date", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("formatDateTime", () => {
  it("does not invent a time for a bare date", () => {
    expect(formatDateTime("2026-08-17")).toBe("Aug 17, 2026");
  });

  it("keeps showing the time for a real instant", () => {
    expect(formatDateTime("2026-08-18T18:00:00Z")).toMatch(/Aug 18, 2:00 PM/);
  });
});

describe("formatDay", () => {
  it("names the weekday of a bare date without shifting it", () => {
    // The Arch class meets Mondays.
    expect(formatDay("2026-08-17")).toBe("Mon, Aug 17");
    expect(formatDay("2026-11-30")).toBe("Mon, Nov 30");
  });

  it("falls back to formatDate for anything that is not a bare date", () => {
    expect(formatDay(null)).toBe("—");
  });
});
