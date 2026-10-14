"use client";

// The three data tables on /[fund]/performance (SPEC 11.2 / 14). Client
// islands so the columns sort; the page computes the rows on the server and
// passes them down as plain data.
//
// The period-return table and the monthly-return grid stay on the page and
// stay unsorted on purpose: MTD → SI and Jan → Dec are the orders that carry
// the meaning, and a click that scrambled them would only lose information.
//
// Sector names link to the sector page. Attribution and sector P&L rows carry
// only the name, so the page passes a name → slug map for those.

import type { ReactNode } from "react";
import Link from "next/link";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/ui/SortableTable";
import { SectorLink } from "@/components/ui/SectorLink";
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

/** Sector name → slug, for rows that only know the name. */
export type SectorSlugs = Record<string, string>;

/**
 * An empty table's next step: a link for whoever can take it, a plain
 * sentence for everyone else.
 */
function emptyHint(
  lead: string,
  manage: { href: string; label: string; todo: string } | null,
  otherwise: string
): ReactNode {
  return manage ? (
    <>
      {lead} {manage.todo} on{" "}
      <Link href={manage.href} className="font-medium text-accent-text hover:underline">
        {manage.label}
      </Link>
      .
    </>
  ) : (
    `${lead} ${otherwise}`
  );
}

// ── Sector weights vs benchmark ─────────────────────────────────────────────

const activeWeight = (s: SectorWeight) =>
  s.benchmarkWeightPct !== null ? s.weightPct - s.benchmarkWeightPct : null;

const weightColumns = (fund: string): SortableColumn<SectorWeight>[] => [
  {
    key: "sector",
    label: "Sector",
    align: "left",
    defaultDir: "asc",
    sortValue: (s) => s.sectorName,
    render: (s) => (
      <SectorLink
        fund={fund}
        slug={s.sectorSlug}
        name={s.sectorName}
        className="font-medium"
      />
    ),
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
  fund,
  sectors,
  gains,
  sectorSlugs = {},
  manageSectorsHref = null,
}: {
  fund: string;
  sectors: SectorWeight[];
  gains?: SectorGain[];
  sectorSlugs?: SectorSlugs;
  /** Manage sectors, for people who may open it; null hides the link. */
  manageSectorsHref?: string | null;
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
        columns={weightColumns(fund)}
        rowKey={(s) => s.sectorId}
        initialSort={{ key: "weight", dir: "desc" }}
        caption="Sector weights versus benchmark"
        emptyMessage={emptyHint(
          "No sector data yet.",
          manageSectorsHref
            ? {
                href: manageSectorsHref,
                label: "Manage sectors",
                todo: "Add sectors and set benchmark weights",
              }
            : null,
          "An officer adds sectors and sets benchmark weights."
        )}
      />
    );
  }
  return (
    <SortableTable
      rows={gains}
      columns={gainColumns(fund, sectorSlugs)}
      rowKey={(g) => g.sectorName}
      initialSort={{ key: "gain", dir: "desc" }}
      caption="Unrealized gain by sector"
      emptyMessage={emptyHint(
        "No sector data yet.",
        manageSectorsHref
          ? { href: manageSectorsHref, label: "Manage sectors", todo: "Add sectors" }
          : null,
        "An officer adds sectors."
      )}
    />
  );
}

// ── Sector P&L (when no targets are set) ────────────────────────────────────

const gainColumns = (
  fund: string,
  sectorSlugs: SectorSlugs
): SortableColumn<SectorGain>[] => [
  {
    key: "sector",
    label: "Sector",
    align: "left",
    defaultDir: "asc",
    sortValue: (g) => g.sectorName.toLowerCase(),
    render: (g) => (
      <span className="font-medium">
        <SectorLink
          fund={fund}
          slug={sectorSlugs[g.sectorName]}
          name={g.sectorName}
        />
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

const attributionColumns = (
  fund: string,
  sectorSlugs: SectorSlugs
): SortableColumn<SectorContribution>[] => [
  {
    key: "sector",
    label: "Sector",
    align: "left",
    defaultDir: "asc",
    sortValue: (r) => r.sectorName,
    render: (r) => (
      <SectorLink
        fund={fund}
        slug={sectorSlugs[r.sectorName]}
        name={r.sectorName}
        className="font-medium"
      />
    ),
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
  fund,
  rows,
  coveredWeightPct,
  totalPct,
  sectorSlugs = {},
}: {
  fund: string;
  rows: SectorContribution[];
  coveredWeightPct: number;
  totalPct: number;
  sectorSlugs?: SectorSlugs;
}) {
  return (
    <SortableTable
      rows={rows}
      columns={attributionColumns(fund, sectorSlugs)}
      rowKey={(r) => r.sectorName}
      initialSort={{ key: "contribution", dir: "desc" }}
      caption="Contribution to return by sector"
      footer={
        <tr className="border-t border-card-border text-xs sm:text-sm">
          <td className="sticky left-0 z-10 bg-sticky-card px-3 py-2.5 font-semibold sm:px-6">
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

export function RatingBucketTable({
  rows,
  manageHoldingsHref = null,
}: {
  rows: RatingBucketRow[];
  /** Manage holdings, for people who may open it; null hides the link. */
  manageHoldingsHref?: string | null;
}) {
  return (
    <SortableTable
      rows={rows}
      columns={ratingColumns}
      rowKey={(r) => r.bucket}
      initialSort={{ key: "bucket", dir: "asc" }}
      caption="Allocation by rating bucket"
      emptyMessage={emptyHint(
        "No rated positions yet.",
        manageHoldingsHref
          ? {
              href: manageHoldingsHref,
              label: "Manage holdings",
              todo: "Set each holding's rating",
            }
          : null,
        "An officer sets each holding's rating."
      )}
    />
  );
}
