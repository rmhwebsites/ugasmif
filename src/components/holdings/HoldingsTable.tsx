"use client";

// Full holdings table (SPEC 11.2): sortable columns, sticky header, sticky
// first column on horizontal scroll (GBH HoldingsTable pattern), sector +
// instrument-type filters, CSV export. Column set switches on the fund's
// asset class — equity columns for Athena, bond columns for Arch. Row click
// opens /[fund]/holdings/[id]. `compact` renders the same table without the
// filter bar or card chrome for the dashboard's top-positions slice.

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { PriceSourceBadge } from "@/components/holdings/PriceSourceBadge";
import { SecurityLogo } from "@/components/holdings/SecurityLogo";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import {
  formatBondPrice,
  formatCurrency,
  formatCurrencyWhole,
  formatDate,
  formatNumber,
  formatPercent,
  formatSignedCurrency,
  formatSignedPercent,
} from "@/lib/format";
import type { AssetClass, FundSlug, HoldingValuation } from "@/types/domain";

const TYPE_LABELS: Record<string, string> = {
  equity: "Equity",
  etf: "ETF",
  treasury: "Treasury",
  corporate: "Corporate",
  agency_mbs: "Agency MBS",
  municipal: "Municipal",
  money_market: "Money Market",
};

const TYPE_ORDER = [
  "equity",
  "etf",
  "treasury",
  "corporate",
  "agency_mbs",
  "municipal",
  "money_market",
];

const UNASSIGNED = "__unassigned__";

interface Column {
  key: string;
  label: string;
  align?: "left" | "right";
  /** Direction of the first click on this header. */
  defaultDir: "asc" | "desc";
  sortValue: (v: HoldingValuation) => string | number | null;
  render: (v: HoldingValuation) => ReactNode;
  /** Extra classes on both th and td (responsive hiding). */
  className?: string;
  first?: boolean;
}

function gainPct(v: HoldingValuation): number | null {
  return v.costBasis > 0 ? (v.unrealizedGain / v.costBasis) * 100 : null;
}

/** Since-added return for a position: (price − avg cost) / avg cost. Null
 *  without a live price or a cost (transfers in can sit at avg_cost 0), which
 *  is why it is not read off unrealizedGain — that falls back to cost basis
 *  when a price is missing and would read as a flat 0%. */
function sinceAddedPct(v: HoldingValuation): number | null {
  const avgCost = Number(v.holding.avg_cost);
  if (v.price === null || !Number.isFinite(avgCost) || avgCost <= 0) return null;
  return ((v.price - avgCost) / avgCost) * 100;
}

/** Stacked $ / % cell colored by sign (GBH day-change pattern). */
function SignedPair({
  amount,
  pct,
}: {
  amount: number | null;
  pct: number | null;
}) {
  if (amount === null && pct === null) {
    return <span className="text-muted">—</span>;
  }
  const positive = (amount ?? pct ?? 0) >= 0;
  const cls = positive ? "text-gain" : "text-loss";
  return (
    <div className="flex flex-col items-end">
      <span className={`text-[11px] font-medium sm:text-sm ${cls}`}>
        {formatSignedPercent(pct)}
      </span>
      <span className={`text-[10px] sm:text-xs ${cls}`}>
        {formatSignedCurrency(amount)}
      </span>
    </div>
  );
}

function WeightCell({ weightPct }: { weightPct: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-card-border sm:block">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.min(Math.max(weightPct, 0), 100)}%` }}
        />
      </div>
      <span className="text-xs text-muted sm:text-sm">
        {formatPercent(weightPct)}
      </span>
    </div>
  );
}

function buildColumns(assetClass: AssetClass, fund: FundSlug): Column[] {
  if (assetClass === "equity") {
    return [
      {
        key: "symbol",
        label: "Symbol",
        align: "left",
        defaultDir: "asc",
        first: true,
        sortValue: (v) => v.holding.symbol ?? v.holding.name,
        render: (v) => (
          <Link
            href={`/${fund}/holdings/${v.holding.id}`}
            className="flex items-center gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <SecurityLogo
              symbol={v.holding.symbol}
              name={v.holding.name}
              size="sm"
            />
            <span className="min-w-0">
              <span className="block text-xs font-semibold text-foreground sm:text-sm">
                {v.holding.symbol ?? "—"}
              </span>
              <span className="block max-w-[110px] truncate text-[10px] text-muted md:hidden">
                {v.holding.name}
              </span>
            </span>
          </Link>
        ),
      },
      {
        key: "name",
        label: "Name",
        align: "left",
        defaultDir: "asc",
        className: "hidden md:table-cell",
        sortValue: (v) => v.holding.name,
        render: (v) => (
          <span className="block max-w-[200px] truncate text-muted">
            {v.holding.name}
          </span>
        ),
      },
      {
        key: "sector",
        label: "Sector",
        align: "left",
        defaultDir: "asc",
        className: "hidden lg:table-cell",
        sortValue: (v) => v.sectorName,
        render: (v) => (
          <span className="block max-w-[140px] truncate text-muted">
            {v.sectorName ?? "—"}
          </span>
        ),
      },
      {
        key: "shares",
        label: "Shares",
        defaultDir: "desc",
        className: "hidden sm:table-cell",
        sortValue: (v) => Number(v.holding.quantity),
        render: (v) => (
          <span className="text-muted">
            {formatNumber(Number(v.holding.quantity))}
          </span>
        ),
      },
      {
        key: "price",
        label: "Price",
        defaultDir: "desc",
        sortValue: (v) => v.price,
        render: (v) => (
          <div className="flex flex-col items-end gap-0.5">
            <span className="font-medium">{formatCurrency(v.price)}</span>
            {(v.stale || v.priceSource !== "live") && (
              <PriceSourceBadge
                source={v.priceSource}
                markedAt={v.markedAt}
                stale={v.stale}
              />
            )}
          </div>
        ),
      },
      {
        key: "day",
        label: "Day Chg",
        defaultDir: "desc",
        sortValue: (v) => v.dayChangePct,
        render: (v) => <SignedPair amount={v.dayChange} pct={v.dayChangePct} />,
      },
      {
        key: "marketValue",
        label: "Mkt Value",
        defaultDir: "desc",
        sortValue: (v) => v.marketValue,
        render: (v) => (
          <span className="font-medium">{formatCurrency(v.marketValue)}</span>
        ),
      },
      {
        key: "weight",
        label: "Weight",
        defaultDir: "desc",
        sortValue: (v) => v.weightPct,
        render: (v) => <WeightCell weightPct={v.weightPct} />,
      },
      {
        key: "costBasis",
        label: "Cost Basis",
        defaultDir: "desc",
        className: "hidden lg:table-cell",
        sortValue: (v) => v.costBasis,
        render: (v) => (
          <span className="text-muted">{formatCurrency(v.costBasis)}</span>
        ),
      },
      {
        key: "gain",
        label: "Unrl Gain",
        defaultDir: "desc",
        sortValue: (v) => gainPct(v),
        render: (v) => <SignedPair amount={v.unrealizedGain} pct={gainPct(v)} />,
      },
      {
        key: "sinceAdded",
        label: "Since Added",
        defaultDir: "desc",
        className: "hidden lg:table-cell",
        sortValue: (v) => sinceAddedPct(v),
        render: (v) => {
          const pct = sinceAddedPct(v);
          if (pct === null) return <span className="text-muted">—</span>;
          return (
            <div className="flex flex-col items-end">
              <span
                className={`text-[11px] font-medium sm:text-sm ${
                  pct >= 0 ? "text-gain" : "text-loss"
                }`}
              >
                {formatSignedPercent(pct)}
              </span>
              {v.holding.opened_on && (
                <span className="text-[10px] text-muted sm:text-xs">
                  since {formatDate(v.holding.opened_on)}
                </span>
              )}
            </div>
          );
        },
      },
    ];
  }

  // Fixed income columns (Arch)
  return [
    {
      key: "name",
      label: "Name",
      align: "left",
      defaultDir: "asc",
      first: true,
      sortValue: (v) => v.holding.name,
      render: (v) => (
        <Link
          href={`/${fund}/holdings/${v.holding.id}`}
          className="block"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="max-w-[150px] truncate text-xs font-semibold text-foreground sm:max-w-[220px] sm:text-sm">
            {v.holding.name}
          </p>
          <p className="text-[10px] text-muted md:hidden">
            {TYPE_LABELS[v.holding.instrument_type] ?? v.holding.instrument_type}
          </p>
        </Link>
      ),
    },
    {
      key: "type",
      label: "Type",
      align: "left",
      defaultDir: "asc",
      className: "hidden md:table-cell",
      sortValue: (v) =>
        TYPE_LABELS[v.holding.instrument_type] ?? v.holding.instrument_type,
      render: (v) => (
        <span className="text-muted">
          {TYPE_LABELS[v.holding.instrument_type] ?? v.holding.instrument_type}
        </span>
      ),
    },
    {
      key: "sector",
      label: "Sector",
      align: "left",
      defaultDir: "asc",
      className: "hidden xl:table-cell",
      sortValue: (v) => v.sectorName,
      render: (v) => (
        <span className="block max-w-[120px] truncate text-muted">
          {v.sectorName ?? "—"}
        </span>
      ),
    },
    {
      key: "face",
      label: "Face",
      defaultDir: "desc",
      sortValue: (v) => Number(v.holding.quantity),
      render: (v) => (
        <span className="text-muted">
          {formatCurrencyWhole(Number(v.holding.quantity))}
        </span>
      ),
    },
    {
      key: "coupon",
      label: "Coupon",
      defaultDir: "desc",
      className: "hidden sm:table-cell",
      sortValue: (v) =>
        v.holding.coupon_rate !== null ? Number(v.holding.coupon_rate) : null,
      render: (v) => (
        <span className="text-muted">
          {v.holding.coupon_rate !== null
            ? formatPercent(Number(v.holding.coupon_rate), 3)
            : "—"}
        </span>
      ),
    },
    {
      key: "maturity",
      label: "Maturity",
      defaultDir: "asc",
      className: "hidden sm:table-cell",
      sortValue: (v) => v.holding.maturity_date,
      render: (v) => (
        <span className="text-muted">{formatDate(v.holding.maturity_date)}</span>
      ),
    },
    {
      key: "price",
      label: "Price",
      defaultDir: "desc",
      sortValue: (v) => v.price,
      render: (v) => (
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-medium">{formatBondPrice(v.price)}</span>
          <PriceSourceBadge
            source={v.priceSource}
            markedAt={v.markedAt}
            stale={v.stale}
          />
        </div>
      ),
    },
    {
      key: "accrued",
      label: "Accrued",
      defaultDir: "desc",
      className: "hidden lg:table-cell",
      sortValue: (v) => v.accruedInterest,
      render: (v) => (
        <span className="text-muted">{formatCurrency(v.accruedInterest)}</span>
      ),
    },
    {
      key: "marketValue",
      label: "Mkt Value",
      defaultDir: "desc",
      sortValue: (v) => v.marketValue,
      render: (v) => (
        <span className="font-medium">{formatCurrency(v.marketValue)}</span>
      ),
    },
    {
      key: "weight",
      label: "Weight",
      defaultDir: "desc",
      sortValue: (v) => v.weightPct,
      render: (v) => <WeightCell weightPct={v.weightPct} />,
    },
    {
      key: "ytm",
      label: "YTM",
      defaultDir: "desc",
      sortValue: (v) => v.ytm,
      render: (v) => <span>{formatPercent(v.ytm, 2)}</span>,
    },
    {
      key: "duration",
      label: "Dur",
      defaultDir: "desc",
      className: "hidden md:table-cell",
      sortValue: (v) => v.duration,
      render: (v) => (
        <span className="text-muted">
          {v.duration !== null ? formatNumber(v.duration, 1) : "—"}
        </span>
      ),
    },
    {
      key: "rating",
      label: "Rating",
      align: "left",
      defaultDir: "asc",
      className: "hidden lg:table-cell",
      sortValue: (v) => v.holding.rating,
      render: (v) => (
        <span className="text-muted">{v.holding.rating ?? "—"}</span>
      ),
    },
  ];
}

export function HoldingsTable({
  holdings,
  fund,
  assetClass,
  compact = false,
}: {
  holdings: HoldingValuation[];
  fund: FundSlug;
  assetClass: AssetClass;
  /** Dashboard slice: drops the filter bar, the CSV export and the card
   *  chrome, because the caller supplies the card and the "all holdings"
   *  link. Sorting still works. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "weight",
    dir: "desc",
  });
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const columns = useMemo(() => buildColumns(assetClass, fund), [assetClass, fund]);

  const sectorOptions = useMemo(() => {
    const names = [
      ...new Set(
        holdings
          .map((v) => v.sectorName)
          .filter((name): name is string => name !== null)
      ),
    ].sort((a, b) => a.localeCompare(b));
    const hasUnassigned = holdings.some((v) => v.sectorName === null);
    return { names, hasUnassigned };
  }, [holdings]);

  const typeOptions = useMemo(() => {
    const present = new Set<string>(
      holdings.map((v) => v.holding.instrument_type)
    );
    return TYPE_ORDER.filter((t) => present.has(t)).concat(
      [...present].filter((t) => !TYPE_ORDER.includes(t))
    );
  }, [holdings]);

  const filtered = useMemo(
    () =>
      holdings.filter((v) => {
        if (sectorFilter !== "all") {
          if (sectorFilter === UNASSIGNED) {
            if (v.sectorName !== null) return false;
          } else if (v.sectorName !== sectorFilter) {
            return false;
          }
        }
        if (typeFilter !== "all" && v.holding.instrument_type !== typeFilter) {
          return false;
        }
        return true;
      }),
    [holdings, sectorFilter, typeFilter]
  );

  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const withVal = filtered.map((v) => ({ v, s: col.sortValue(v) }));
    const nonNull = withVal.filter((x) => x.s !== null && x.s !== "");
    const nulls = withVal.filter((x) => x.s === null || x.s === "");
    nonNull.sort((a, b) => {
      const av = a.s as string | number;
      const bv = b.s as string | number;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return [...nonNull, ...nulls].map((x) => x.v);
  }, [filtered, sort, columns]);

  if (holdings.length === 0) {
    return (
      <EmptyState
        title="No holdings yet"
        hint={
          assetClass === "equity"
            ? "The portfolio manager can add positions under Admin → Holdings, or execute a passed pitch to open one."
            : "The portfolio manager can add bonds under Admin → Holdings — set the pricing method and enter a first mark for manually priced issues."
        }
      />
    );
  }

  const toggleSort = (col: Column) => {
    setSort((prev) =>
      prev.key === col.key
        ? { key: col.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: col.key, dir: col.defaultDir }
    );
  };

  const filtering = sectorFilter !== "all" || typeFilter !== "all";
  const selectClass =
    "cursor-pointer rounded-lg border border-input-border bg-input-bg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-highlight focus:outline-none";

  return (
    <div className={compact ? "overflow-hidden" : "glass-card overflow-hidden"}>
      {/* Filter bar */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2 border-b border-card-border px-4 py-3 sm:px-6">
          <select
            aria-label="Filter by sector"
            value={sectorFilter}
            onChange={(e) => setSectorFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">All sectors</option>
            {sectorOptions.names.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {sectorOptions.hasUnassigned && (
              <option value={UNASSIGNED}>Unassigned</option>
            )}
          </select>
          <select
            aria-label="Filter by instrument type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={selectClass}
          >
            <option value="all">All types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
          {filtering && (
            <span className="text-xs text-muted">
              {filtered.length} of {holdings.length}
            </span>
          )}
          <a
            href={`/api/${fund}/holdings/export`}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-input-border bg-input-bg px-3 py-1.5 text-xs font-medium transition-colors hover:bg-highlight"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export CSV
          </a>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="p-8 text-center">
          <p className="text-sm text-muted">
            No holdings match these filters.
          </p>
          <Button
            variant="ghost"
            className="mt-2"
            onClick={() => {
              setSectorFilter("all");
              setTypeFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <div className={compact ? "overflow-auto" : "max-h-[70vh] overflow-auto"}>
          <table
            className="w-full"
            style={{ minWidth: assetClass === "equity" ? 900 : 1000 }}
          >
            <thead>
              <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-wider text-muted sm:text-xs">
                {columns.map((col) => {
                  const active = sort.key === col.key;
                  const Icon = active
                    ? sort.dir === "asc"
                      ? ArrowUp
                      : ArrowDown
                    : ArrowUpDown;
                  return (
                    <th
                      key={col.key}
                      aria-sort={
                        active
                          ? sort.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      className={`sticky top-0 bg-sticky py-2.5 font-medium backdrop-blur-xl sm:py-3 ${
                        col.first
                          ? "left-0 z-30 px-3 sm:px-6"
                          : "z-20 px-2 sm:px-4"
                      } ${col.align === "right" || !col.align ? "text-right" : "text-left"} ${
                        col.className ?? ""
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap uppercase tracking-wider transition-colors hover:text-foreground ${
                          active ? "text-foreground" : ""
                        }`}
                      >
                        {col.label}
                        <Icon
                          className={`h-3 w-3 ${
                            active ? "text-accent" : "opacity-40"
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((v) => (
                <tr
                  key={v.holding.id}
                  onClick={() => router.push(`/${fund}/holdings/${v.holding.id}`)}
                  className="group cursor-pointer border-b border-card-border/50 transition-colors hover:bg-highlight"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`py-3 text-xs sm:py-3.5 sm:text-sm ${
                        col.first
                          ? "sticky left-0 z-10 bg-sticky px-3 backdrop-blur-xl transition-colors group-hover:bg-highlight sm:px-6"
                          : "px-2 sm:px-4"
                      } ${
                        col.align === "right" || !col.align
                          ? "text-right"
                          : "text-left"
                      } ${col.className ?? ""}`}
                    >
                      {col.render(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
