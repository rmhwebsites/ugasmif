// Synthetic-snapshot tests for the TWR/performance math (SPEC Section 14).
// Pure functions only — no supabase, no network.

import { describe, expect, it } from "vitest";
import type { CashMovement, FundSnapshot } from "@/types/domain";
import {
  benchmarkReturnSeries,
  dailyReturnSeries,
  drawdownSeries,
  monthlyReturnTable,
  riskMetrics,
  timeWeightedReturns,
} from "@/lib/performance";

let idCounter = 0;

function makeSnapshot(
  date: string,
  total: number,
  benchmark: number | null = null
): FundSnapshot {
  idCounter += 1;
  return {
    id: `snap-${idCounter}`,
    fund_id: "fund-1",
    snapshot_date: date,
    market_value: total,
    cash: 0,
    total_value: total,
    benchmark_symbol: "SPY",
    benchmark_close: benchmark,
    benchmark_adj_close: benchmark,
    detail: {},
    created_at: `${date}T21:45:00Z`,
  };
}

function makeFlow(
  date: string,
  amount: number,
  kind: CashMovement["kind"] = "contribution"
): CashMovement {
  idCounter += 1;
  return {
    id: `flow-${idCounter}`,
    fund_id: "fund-1",
    kind,
    amount,
    holding_id: null,
    occurred_on: date,
    recorded_by: "user-1",
    notes: null,
    created_at: `${date}T12:00:00Z`,
  };
}

describe("timeWeightedReturns / dailyReturnSeries", () => {
  it("ignores a contribution: 100 -> 110 with a $10 contribution that day is 0%", () => {
    const snapshots = [
      makeSnapshot("2026-09-01", 100),
      makeSnapshot("2026-09-02", 110),
    ];
    const flows = [makeFlow("2026-09-02", 10, "contribution")];

    const series = dailyReturnSeries(snapshots, flows);
    expect(series).toHaveLength(2);
    expect(series[1].value).toBeCloseTo(1, 10); // growth of $1 unchanged

    const periods = timeWeightedReturns(snapshots, flows, ["MTD", "SI"]);
    const mtd = periods.find((p) => p.label === "MTD");
    const si = periods.find((p) => p.label === "SI");
    expect(mtd?.fund).toBeCloseTo(0, 10);
    expect(si?.fund).toBeCloseTo(0, 10);
  });

  it("treats a withdrawal (negative flow) symmetrically: 100 -> 90 with -$10 is 0%", () => {
    const snapshots = [
      makeSnapshot("2026-09-01", 100),
      makeSnapshot("2026-09-02", 90),
    ];
    const flows = [makeFlow("2026-09-02", -10, "withdrawal")];
    const [si] = timeWeightedReturns(snapshots, flows, ["SI"]);
    expect(si.fund).toBeCloseTo(0, 10);
  });

  it("chain-links two +10% days into 21%", () => {
    const snapshots = [
      makeSnapshot("2026-09-01", 100),
      makeSnapshot("2026-09-02", 110),
      makeSnapshot("2026-09-03", 121),
    ];
    const series = dailyReturnSeries(snapshots, []);
    expect(series).toHaveLength(3);
    expect(series[0].value).toBeCloseTo(1, 10);
    expect(series[1].value).toBeCloseTo(1.1, 10);
    expect(series[2].value).toBeCloseTo(1.21, 10);

    const [si] = timeWeightedReturns(snapshots, [], ["SI"]);
    expect(si.fund).toBeCloseTo(21, 8); // percent
  });

  it("computes the fund-vs-benchmark difference from adj close", () => {
    const snapshots = [
      makeSnapshot("2026-09-01", 100, 500),
      makeSnapshot("2026-09-02", 110, 505), // fund +10%, benchmark +1%
    ];
    const [si] = timeWeightedReturns(snapshots, [], ["SI"]);
    expect(si.fund).toBeCloseTo(10, 8);
    expect(si.benchmark).toBeCloseTo(1, 8);
    expect(si.diff).toBeCloseTo(9, 8);

    const bench = benchmarkReturnSeries(snapshots);
    expect(bench[bench.length - 1].value).toBeCloseTo(1.01, 10);
  });

  it("returns null cells when there are fewer than two snapshots", () => {
    const periods = timeWeightedReturns([makeSnapshot("2026-09-01", 100)], []);
    for (const p of periods) {
      expect(p.fund).toBeNull();
      expect(p.benchmark).toBeNull();
      expect(p.diff).toBeNull();
    }
  });
});

describe("drawdownSeries / riskMetrics max drawdown", () => {
  it("a 100 -> 120 -> 90 -> 100 path bottoms at -25%", () => {
    const snapshots = [
      makeSnapshot("2026-09-01", 100),
      makeSnapshot("2026-09-02", 120),
      makeSnapshot("2026-09-03", 90),
      makeSnapshot("2026-09-04", 100),
    ];
    const dd = drawdownSeries(dailyReturnSeries(snapshots, []));
    expect(dd[0].value).toBeCloseTo(0, 10);
    expect(dd[1].value).toBeCloseTo(0, 10); // new peak
    expect(dd[2].value).toBeCloseTo(-25, 8); // (90-120)/120
    expect(Math.min(...dd.map((p) => p.value))).toBeCloseTo(-25, 8);
  });

  it("riskMetrics reports maxDrawdown 25 (positive percent) on the same shape", () => {
    // Pad with 17 flat days so the 20-snapshot minimum is met.
    const snapshots: FundSnapshot[] = [];
    for (let day = 1; day <= 17; day += 1) {
      snapshots.push(makeSnapshot(`2026-08-${String(day).padStart(2, "0")}`, 100));
    }
    snapshots.push(makeSnapshot("2026-09-01", 120));
    snapshots.push(makeSnapshot("2026-09-02", 90));
    snapshots.push(makeSnapshot("2026-09-03", 100));

    const metrics = riskMetrics(snapshots);
    expect(metrics).not.toBeNull();
    expect(metrics?.maxDrawdown).toBeCloseTo(25, 8);
    expect(metrics?.volatility).toBeGreaterThan(0);
    expect(metrics?.beta).toBeNull(); // no benchmark data on these snapshots
  });

  it("returns null below 20 snapshots", () => {
    const snapshots = [
      makeSnapshot("2026-09-01", 100),
      makeSnapshot("2026-09-02", 120),
      makeSnapshot("2026-09-03", 90),
      makeSnapshot("2026-09-04", 100),
    ];
    expect(riskMetrics(snapshots)).toBeNull();
  });
});

describe("monthlyReturnTable", () => {
  it("buckets returns into calendar months and years", () => {
    const snapshots = [
      makeSnapshot("2025-12-30", 100),
      makeSnapshot("2025-12-31", 100), // Dec 2025: 0%
      makeSnapshot("2026-01-15", 110), // Jan 2026: +10% (vs 2025-12-31)
      makeSnapshot("2026-02-10", 121), // Feb 2026: +10%
    ];
    const table = monthlyReturnTable(snapshots, []);
    expect(table).toHaveLength(2);

    const y2026 = table.find((row) => row.year === 2026);
    const y2025 = table.find((row) => row.year === 2025);
    expect(y2026).toBeDefined();
    expect(y2025).toBeDefined();

    expect(y2026?.months[0]).toBeCloseTo(10, 8); // Jan
    expect(y2026?.months[1]).toBeCloseTo(10, 8); // Feb
    for (let m = 2; m < 12; m += 1) expect(y2026?.months[m]).toBeNull();
    expect(y2026?.total).toBeCloseTo(21, 8); // chained across the year

    expect(y2025?.months[11]).toBeCloseTo(0, 10); // Dec
    for (let m = 0; m < 11; m += 1) expect(y2025?.months[m]).toBeNull();
    expect(y2025?.total).toBeCloseTo(0, 10);
  });

  it("flow-adjusts inside a month bucket", () => {
    const snapshots = [
      makeSnapshot("2026-03-02", 100),
      makeSnapshot("2026-03-03", 150), // +$40 contribution, so only +10% real
    ];
    const flows = [makeFlow("2026-03-03", 40, "contribution")];
    const table = monthlyReturnTable(snapshots, flows);
    const y2026 = table.find((row) => row.year === 2026);
    expect(y2026?.months[2]).toBeCloseTo(10, 8); // Mar
  });
});
