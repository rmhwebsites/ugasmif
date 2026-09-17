"use client";

// The three data tables on /[fund]/performance (SPEC 11.2 / 14). Client
// islands so the columns sort; the page computes the rows on the server and
// passes them down as plain data.
//
// The period-return table and the monthly-return grid stay on the page and
// stay unsorted on purpose: MTD → SI and Jan → Dec are the orders that carry
// the meaning, and a click that scrambled them would only lose information.

import {
  SortableTable,
  type SortableColumn,
} from "@/components/ui/SortableTable";
import {
  formatCurrencyWhole,
  formatPercent,
  formatSignedPercent,
} from "@/lib/format";
import type { SectorGain } from "@/lib/analysis";
import type { SectorContribution } from "@/lib/performance";
import type { SectorWeight } from "@/types/domain";

function cellClass(value: number | null): string {
  if (value === null || value === 0) return "";
  return value > 0 ? "text-gain" : "text-loss";
}

function pct(value: number | null): string {
  return value === null ? "—" : formatSignedPercent(value);
}

// ── Sector weights vs benchmark ─────────────────────────────────────────────

const activeWeight = (s: SectorWeight) =>
  s.benchmarkWeightPct !== null ? s.weightPct - s.benchmarkWeightPct : null;

const weightColumns: SortableColumn<SectorWeight>[] = [
  {
    key: "sector",
    label: "Sector",
    align: "left",
    defaultDir: "asc",
    sortValue: (s) => s.sectorName,
    render: (s) => <span className="font-medium">{s.sectorName}</span>,
  },
  {
    key: "weight",
    label: "Weight",
    sortValue: (s) => s.weightPct,
    render: (s) => (
      <span className="tabular-nums">{formatPercent(s.weightPct)}</span>
    ),
  },
  {
    key: "target",
    label: "Target",
    sortValue: (s) => s.targetWeightPct,
    render: (s) => (
      <span className="tabular-nums text-muted">
        {s.targetWeightPct !== null ? formatPercent(s.targetWeightPct) : "—"}
      </span>
    ),
  },
  {
    key: "benchmark",
    label: "Benchmark",
    sortValue: (s) => s.benchmarkWeightPct,
    render: (s) => (
      <span className="tabular-nums text-muted">
        {s.benchmarkWeightPct !== null
          ? formatPercent(s.benchmarkWeightPct)
          : "—"}
      </span>
    ),
  },
  {
    key: "active",
    label: "Active",
    sortValue: (s) => activeWeight(s),
    render: (s) => (
      <span
        className={`font-medium tabular-nums ${cellClass(activeWeight(s))}`}
      >
        {pct(activeWeight(s))}
      </span>
    ),
  },
];

export function SectorWeightsTable({
  sectors,
  gains,
}: {
  sectors: SectorWeight[];
  gains?: SectorGain[];
}) {
  // Target and benchmark stay behind Fund Admin, so on a fund that has not
  // filled them in those three columns are pure dashes. Drop them and show
  // what the sector actually did instead — same width, real content.
  const hasTargets = sectors.some(
    (s) => s.targetWeightPct !== null || s.benchmarkWeightPct !== null
  );
  if (hasTargets || !gains) {
    return (
      <SortableTable
        rows={sectors}
        columns={weightColumns}
        rowKey={(s) => s.sectorId}
        initialSort={{ key: "weight", dir: "desc" }}
        caption="Sector weights versus benchmark"
        emptyMessage="No sector data yet. Officers add sectors and set benchmark weights under Fund Admin → Sectors."
      />
    );
  }
  return (
    <SortableTable
      rows={gains}
      columns={gainColumns}
      rowKey={(g) => g.sectorName}
      initialSort={{ key: "gain", dir: "desc" }}
      caption="Unrealized gain by sector"
      emptyMessage="No sector data yet. Officers add sectors under Fund Admin → Sectors."
    />
  );
}

// ── Sector P&L (when no targets are set) ────────────────────────────────────

const gainColumns: SortableColumn<SectorGain>[] = [
  {
    key: "sector",
    label: "Sector",
    align: "left",
    defaultDir: "asc",
    sortValue: (g) => g.sectorName.toLowerCase(),
    render: (g) => (
      <span className="font-medium">
        {g.sectorName}
        <span className="ml-2 text-xs text-muted">
          {g.positions} {g.positions === 1 ? "name" : "names"}
        </span>
      </span>
    ),
  },
  {
    key: "weight",
    label: "Weight",
    sortValue: (g) => g.weightPct,
    render: (g) => (
      <span className="tabular-nums">{formatPercent(g.weightPct)}</span>
    ),
  },
  {
    key: "cost",
    label: "Cost",
    sortValue: (g) => g.costBasis,
    render: (g) => (
      <span className="tabular-nums text-muted">
        {formatCurrencyWhole(g.costBasis)}
      </span>
    ),
  },
  {
    key: "value",
    label: "Value",
    sortValue: (g) => g.marketValue,
    render: (g) => (
      <span className="tabular-nums">{formatCurrencyWhole(g.marketValue)}</span>
    ),
  },
  {
    key: "gain",
    label: "Unrealized",
    sortValue: (g) => g.unrealizedGain,
    render: (g) => (
      <span className={`font-medium tabular-nums ${cellClass(g.unrealizedGain)}`}>
        {g.unrealizedGain >= 0 ? "+" : "−"}
        {formatCurrencyWhole(Math.abs(g.unrealizedGain))}
      </span>
    ),
  },
  {
    key: "return",
    label: "Return",
    sortValue: (g) => g.returnPct,
    render: (g) => (
      <span className={`font-medium tabular-nums ${cellClass(g.returnPct)}`}>
        {pct(g.returnPct)}
      </span>
    ),
  },
  {
    key: "share",
    label: "Share of move",
    sortValue: (g) => g.shareOfGainPct,
    render: (g) => (
      <span className="tabular-nums text-muted">{pct(g.shareOfGainPct)}</span>
    ),
  },
];

// ── Sector attribution ──────────────────────────────────────────────────────

const attributionColumns: SortableColumn<SectorContribution>[] = [
  {
    key: "sector",
    label: "Sector",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.sectorName,
    render: (r) => <span className="font-medium">{r.sectorName}</span>,
  },
  {
    key: "startWeight",
    label: "Start weight",
    sortValue: (r) => r.startWeightPct,
    render: (r) => (
      <span className="tabular-nums text-muted">
        {formatPercent(r.startWeightPct)}
      </span>
    ),
  },
  {
    key: "return",
    label: "Return",
    sortValue: (r) => r.returnPct,
    render: (r) => (
      <span className={`tabular-nums ${cellClass(r.returnPct)}`}>
        {formatSignedPercent(r.returnPct)}
      </span>
    ),
  },
  {
    key: "contribution",
    label: "Contribution",
    sortValue: (r) => r.contributionPct,
    render: (r) => (
      <span className={`font-medium tabular-nums ${cellClass(r.contributionPct)}`}>
        {formatSignedPercent(r.contributionPct, 2)}
      </span>
    ),
  },
];

export function SectorAttributionTable({
  rows,
  coveredWeightPct,
  totalPct,
}: {
  rows: SectorContribution[];
  coveredWeightPct: number;
  totalPct: number;
}) {
  return (
    <SortableTable
      rows={rows}
      columns={attributionColumns}
      rowKey={(r) => r.sectorName}
      initialSort={{ key: "contribution", dir: "desc" }}
      caption="Contribution to return by sector"
      footer={
        <tr className="border-t border-card-border">
          <td className="sticky left-0 z-10 bg-sticky px-3 py-2.5 font-semibold backdrop-blur-xl sm:px-6">
            Total
          </td>
          <td className="px-2 py-2.5 text-right tabular-nums text-muted sm:px-4">
            {formatPercent(coveredWeightPct)}
          </td>
          <td className="px-2 py-2.5 sm:px-4" />
          <td
            className={`px-2 py-2.5 text-right font-semibold tabular-nums sm:px-4 ${cellClass(
              totalPct
            )}`}
          >
            {formatSignedPercent(totalPct, 2)}
          </td>
        </tr>
      }
    />
  );
}

// ── Allocation by rating bucket (Arch) ──────────────────────────────────────

export interface RatingBucketRow {
  bucket: string;
  marketValue: number;
  count: number;
  weightPct: number;
  /** Credit order AAA → NR, so the default sort is not alphabetical. */
  order: number;
}

const ratingColumns: SortableColumn<RatingBucketRow>[] = [
  {
    key: "bucket",
    label: "Rating",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.order,
    render: (r) => <span className="font-medium">{r.bucket}</span>,
  },
  {
    key: "count",
    label: "Positions",
    sortValue: (r) => r.count,
    render: (r) => <span className="tabular-nums text-muted">{r.count}</span>,
  },
  {
    key: "marketValue",
    label: "Market value",
    sortValue: (r) => r.marketValue,
    render: (r) => (
      <span className="tabular-nums">{formatCurrencyWhole(r.marketValue)}</span>
    ),
  },
  {
    key: "weight",
    label: "Weight",
    sortValue: (r) => r.weightPct,
    render: (r) => (
      <span className="font-medium tabular-nums">
        {formatPercent(r.weightPct)}
      </span>
    ),
  },
];

export function RatingBucketTable({ rows }: { rows: RatingBucketRow[] }) {
  return (
    <SortableTable
      rows={rows}
      columns={ratingColumns}
      rowKey={(r) => r.bucket}
      initialSort={{ key: "bucket", dir: "asc" }}
      caption="Allocation by rating bucket"
      emptyMessage="No rated positions yet. Ratings are set per holding under Fund Admin → Holdings."
    />
  );
}
