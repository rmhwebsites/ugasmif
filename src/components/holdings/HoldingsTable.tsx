"use client";

// Full holdings table (SPEC 11.2): sortable columns, sticky header, sticky
// first column on horizontal scroll (GBH HoldingsTable pattern), a text
// search plus sector, instrument-type and stale-price filters, CSV export of
// exactly the rows on screen. Column set switches on the fund's asset class:
// equity columns for Athena, bond columns for Arch. Row click opens
// /[fund]/holdings/[id]. `compact` renders the same table without the filter
// bar or card chrome for the dashboard's top-positions slice.
//
// The search and the stale filter live in the URL (?q=, ?price=stale), so a
// filtered table can be linked to. Typing rewrites the address in place
// (history.replaceState), which Next's router picks up without asking the
// server to value the fund again.
//
// On a phone the pinned first column says which security a row is (ticker
// and name, or for a bond its coupon and maturity), and the value and day
// change sit right beside it; the rest is a swipe away.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Download,
  Search,
} from "lucide-react";
import { PriceSourceBadge } from "@/components/holdings/PriceSourceBadge";
import { SecurityLogo } from "@/components/holdings/SecurityLogo";
import {
  UNASSIGNED_SECTOR,
  filterHoldings,
  holdingsExportHref,
} from "@/components/holdings/holdingsFilter";
import { SectorLink } from "@/components/ui/SectorLink";
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

/** How long typing pauses before the search is written to the address. */
const URL_WRITE_DELAY_MS = 300;

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
  /**
   * The sort this column shares with another. Phones get their own copy of
   * a column (to put it beside the pinned one); both copies sort as one.
   */
  sortKey?: string;
}

const sortKeyOf = (col: Column) => col.sortKey ?? col.key;

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

/** Phones: market value over weight, the pair people check first. */
function ValueStack({ v }: { v: HoldingValuation }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[11px] font-medium">
        {formatCurrencyWhole(v.marketValue)}
      </span>
      <span className="text-[10px] text-muted">{formatPercent(v.weightPct)}</span>
    </div>
  );
}

function SectorCell({
  v,
  fund,
  sectorSlugs,
  maxWidth,
}: {
  v: HoldingValuation;
  fund: FundSlug;
  sectorSlugs?: Record<string, string>;
  maxWidth: string;
}) {
  if (!v.sectorName) return <span className="text-muted">—</span>;
  const slug = v.holding.sector_id ? sectorSlugs?.[v.holding.sector_id] : null;
  return (
    <span className={`block truncate text-muted ${maxWidth}`}>
      <SectorLink fund={fund} slug={slug} name={v.sectorName} />
    </span>
  );
}

/** "0.75% · matures Feb 15, 2042 · Treasury": a bond told apart on a phone. */
function bondMeta(v: HoldingValuation): string {
  const h = v.holding;
  const coupon = h.coupon_rate !== null ? Number(h.coupon_rate) : null;
  return [
    coupon !== null && coupon > 0 ? `${coupon}%` : null,
    h.maturity_date ? `matures ${formatDate(h.maturity_date)}` : null,
    TYPE_LABELS[h.instrument_type] ?? h.instrument_type,
  ]
    .filter(Boolean)
    .join(" · ");
}

function buildColumns(
  assetClass: AssetClass,
  fund: FundSlug,
  sectorSlugs?: Record<string, string>
): Column[] {
  // Phone-only copies, placed right after the pinned column. Their desktop
  // twins hide below sm.
  const valuePhone: Column = {
    key: "valuePhone",
    label: "Value",
    defaultDir: "desc",
    className: "sm:hidden",
    sortKey: "weight",
    sortValue: (v) => v.weightPct,
    render: (v) => <ValueStack v={v} />,
  };

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
              <span className="block max-w-[96px] truncate text-[10px] text-muted sm:max-w-[110px] md:hidden">
                {v.holding.name}
              </span>
            </span>
          </Link>
        ),
      },
      valuePhone,
      {
        key: "dayPhone",
        label: "Day",
        defaultDir: "desc",
        className: "sm:hidden",
        sortKey: "day",
        sortValue: (v) => v.dayChangePct,
        render: (v) => <SignedPair amount={v.dayChange} pct={v.dayChangePct} />,
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
          <SectorCell
            v={v}
            fund={fund}
            sectorSlugs={sectorSlugs}
            maxWidth="max-w-[140px]"
          />
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
                price={v.price}
              />
            )}
          </div>
        ),
      },
      {
        key: "day",
        label: "Day change",
        defaultDir: "desc",
        className: "hidden sm:table-cell",
        sortValue: (v) => v.dayChangePct,
        render: (v) => <SignedPair amount={v.dayChange} pct={v.dayChangePct} />,
      },
      {
        key: "marketValue",
        label: "Market value",
        defaultDir: "desc",
        className: "hidden sm:table-cell",
        sortValue: (v) => v.marketValue,
        render: (v) => (
          <span className="font-medium">{formatCurrency(v.marketValue)}</span>
        ),
      },
      {
        key: "weight",
        label: "Weight",
        defaultDir: "desc",
        className: "hidden sm:table-cell",
        sortValue: (v) => v.weightPct,
        render: (v) => <WeightCell weightPct={v.weightPct} />,
      },
      {
        key: "costBasis",
        label: "Cost basis",
        defaultDir: "desc",
        className: "hidden lg:table-cell",
        sortValue: (v) => v.costBasis,
        render: (v) => (
          <span className="text-muted">{formatCurrency(v.costBasis)}</span>
        ),
      },
      {
        key: "gain",
        label: "Unrealized",
        defaultDir: "desc",
        sortValue: (v) => gainPct(v),
        render: (v) => <SignedPair amount={v.unrealizedGain} pct={gainPct(v)} />,
      },
      {
        key: "sinceAdded",
        label: "Since added",
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

  // Fixed income columns (Arch). The name cell carries the ticker when there
  // is one (ETFs), the same label the dashboard and the holding page use.
  return [
    {
      key: "name",
      label: "Name",
      align: "left",
      defaultDir: "asc",
      first: true,
      sortValue: (v) => v.holding.symbol ?? v.holding.name,
      render: (v) => (
        <Link
          href={`/${fund}/holdings/${v.holding.id}`}
          className="block w-[150px] whitespace-normal sm:w-[240px]"
        >
          <span className="line-clamp-2 text-xs text-foreground sm:line-clamp-1 sm:text-sm">
            {v.holding.symbol ? (
              <>
                <span className="font-semibold">{v.holding.symbol}</span>
                <span className="text-muted"> · {v.holding.name}</span>
              </>
            ) : (
              <span className="font-semibold">{v.holding.name}</span>
            )}
          </span>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted md:hidden">
            {bondMeta(v)}
          </span>
        </Link>
      ),
    },
    valuePhone,
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
        <SectorCell
          v={v}
          fund={fund}
          sectorSlugs={sectorSlugs}
          maxWidth="max-w-[120px]"
        />
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
            price={v.price}
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
      label: "Market value",
      defaultDir: "desc",
      className: "hidden sm:table-cell",
      sortValue: (v) => v.marketValue,
      render: (v) => (
        <span className="font-medium">{formatCurrency(v.marketValue)}</span>
      ),
    },
    {
      key: "weight",
      label: "Weight",
      defaultDir: "desc",
      className: "hidden sm:table-cell",
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

/**
 * Rewrite some of the address's query parameters in place. Next's router
 * hears replaceState, so useSearchParams follows without a server round
 * trip. Null removes a parameter.
 */
function writeUrlParams(pathname: string, updates: Record<string, string | null>) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(updates)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const qs = params.toString();
  window.history.replaceState(
    null,
    "",
    `${pathname}${qs ? `?${qs}` : ""}${window.location.hash}`
  );
}

export function HoldingsTable({
  holdings,
  fund,
  assetClass,
  compact = false,
  sectorSlugs,
  scopeSectorId,
}: {
  holdings: HoldingValuation[];
  fund: FundSlug;
  assetClass: AssetClass;
  /** Dashboard slice: drops the filter bar, the CSV export and the card
   *  chrome, because the caller supplies the card and the "all holdings"
   *  link. Sorting still works; the URL filters do not apply. */
  compact?: boolean;
  /** sector_id → sector slug. Makes the Sector column's names links to
   *  each sector's page. */
  sectorSlugs?: Record<string, string>;
  /** Locks the table to one sector (a sector's own page): hides the sector
   *  filter and exports only that sector. */
  scopeSectorId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({
    key: "weight",
    dir: "desc",
  });
  const [sectorFilter, setSectorFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("");

  // ?q= seeds the search box. After that the box leads and the address
  // follows a moment behind; a change to ?q= that the box did not write (a
  // link, the sidebar) wins and resets the box.
  const urlQuery = compact ? "" : (searchParams.get("q") ?? "").trim();
  const [query, setQuery] = useState(urlQuery);
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  const [writtenQuery, setWrittenQuery] = useState(urlQuery);
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery);
    if (urlQuery !== writtenQuery) {
      setQuery(urlQuery);
      setWrittenQuery(urlQuery);
    }
  }
  useEffect(() => {
    const next = query.trim();
    if (compact || next === writtenQuery) return;
    const timer = setTimeout(() => {
      setWrittenQuery(next);
      writeUrlParams(pathname, { q: next || null });
    }, URL_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [compact, query, writtenQuery, pathname]);

  // ?price=stale: read straight from the address; the toggle rewrites it.
  const staleOnly = !compact && searchParams.get("price") === "stale";

  // A table locked to one sector doesn't repeat that sector on every row.
  const columns = useMemo(() => {
    const all = buildColumns(assetClass, fund, sectorSlugs);
    return scopeSectorId ? all.filter((c) => c.key !== "sector") : all;
  }, [assetClass, fund, sectorSlugs, scopeSectorId]);

  // A sector page passes its own rows already; the scope also guards
  // against a caller that passes the whole fund.
  const scoped = useMemo(
    () =>
      scopeSectorId
        ? holdings.filter((v) => v.holding.sector_id === scopeSectorId)
        : holdings,
    [holdings, scopeSectorId]
  );

  const sectorOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const v of scoped) {
      if (v.holding.sector_id && v.sectorName) {
        byId.set(v.holding.sector_id, v.sectorName);
      }
    }
    const options = [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const hasUnassigned = scoped.some((v) => v.holding.sector_id === null);
    return { options, hasUnassigned };
  }, [scoped]);

  const typeOptions = useMemo(() => {
    const present = new Set<string>(
      scoped.map((v) => v.holding.instrument_type)
    );
    return TYPE_ORDER.filter((t) => present.has(t)).concat(
      [...present].filter((t) => !TYPE_ORDER.includes(t))
    );
  }, [scoped]);

  const staleCount = useMemo(
    () => scoped.filter((v) => v.stale).length,
    [scoped]
  );

  const filter = useMemo(
    () =>
      compact
        ? {}
        : {
            q: query,
            sector: scopeSectorId ?? sectorFilter,
            type: typeFilter,
            staleOnly,
          },
    [compact, query, scopeSectorId, sectorFilter, typeFilter, staleOnly]
  );

  const filtered = useMemo(() => filterHoldings(scoped, filter), [scoped, filter]);

  const sorted = useMemo(() => {
    const col = columns.find((c) => sortKeyOf(c) === sort.key);
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

  if (scoped.length === 0) {
    return (
      <EmptyState
        title="No holdings yet"
        hint="Positions appear here once the portfolio manager records a trade."
      />
    );
  }

  const toggleSort = (col: Column) => {
    const key = sortKeyOf(col);
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key, dir: col.defaultDir }
    );
  };

  const toggleStale = () =>
    writeUrlParams(pathname, { price: staleOnly ? null : "stale" });

  const clearFilters = () => {
    setSectorFilter("");
    setTypeFilter("");
    setQuery("");
    setWrittenQuery("");
    writeUrlParams(pathname, { q: null, price: null });
  };

  const filtering =
    query.trim() !== "" ||
    (!scopeSectorId && sectorFilter !== "") ||
    typeFilter !== "" ||
    staleOnly;
  const selectClass =
    "cursor-pointer rounded-lg border border-input-border bg-input-bg px-2.5 py-1.5 text-xs text-foreground transition-colors hover:bg-highlight focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-text";

  return (
    <div className={compact ? "overflow-hidden" : "glass-card overflow-hidden"}>
      {/* Filter bar */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2 border-b border-card-border px-4 py-3 sm:px-6">
          <label className="relative w-full sm:w-52">
            <span className="sr-only">Search holdings</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                assetClass === "equity"
                  ? "Symbol or name"
                  : "Name, symbol or CUSIP"
              }
              className="w-full rounded-lg border border-input-border bg-input-bg py-1.5 pr-2.5 pl-8 text-xs text-foreground outline-none transition-colors focus:border-accent"
            />
          </label>
          {!scopeSectorId && (
            <select
              aria-label="Filter by sector"
              value={sectorFilter}
              onChange={(e) => setSectorFilter(e.target.value)}
              className={selectClass}
            >
              <option value="">All sectors</option>
              {sectorOptions.options.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {sectorOptions.hasUnassigned && (
                <option value={UNASSIGNED_SECTOR}>Unassigned</option>
              )}
            </select>
          )}
          <select
            aria-label="Filter by instrument type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">All types</option>
            {typeOptions.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
          {(staleCount > 0 || staleOnly) && (
            <button
              type="button"
              onClick={toggleStale}
              aria-pressed={staleOnly}
              title="Prices that are out of date: an old mark, a missing quote or no Treasury curve. Hover a row's stale badge for the reason."
              className={`inline-flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                staleOnly
                  ? "bg-yellow-500/15 text-yellow-500"
                  : "bg-highlight text-foreground hover:bg-card-border"
              }`}
            >
              <span className="tabular-nums">{staleCount}</span>
              {staleCount === 1 ? "stale price" : "stale prices"}
              {staleOnly && <span className="text-muted">· show all</span>}
            </button>
          )}
          {filtering && (
            <span className="text-xs text-muted tabular-nums">
              {filtered.length} of {scoped.length}
            </span>
          )}
          <a
            href={holdingsExportHref(fund, filter)}
            title={
              filtering
                ? "Download the holdings shown, as a CSV file."
                : "Download every holding, as a CSV file."
            }
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
            {staleOnly && !query.trim() && !sectorFilter && !typeFilter
              ? "Every price is current."
              : "No holdings match these filters."}
          </p>
          <Button variant="ghost" className="mt-2" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      ) : (
        <div className={compact ? "overflow-auto" : "max-h-[70vh] overflow-auto"}>
          <table
            className={`w-full ${
              assetClass === "equity" ? "sm:min-w-[900px]" : "sm:min-w-[1000px]"
            }`}
          >
            <thead>
              <tr className="border-b border-card-border text-left text-xs font-medium text-muted">
                {columns.map((col) => {
                  const active = sort.key === sortKeyOf(col);
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
                      className={`sticky top-0 bg-sticky-card py-2.5 font-medium sm:py-3 ${
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
                        className={`-mx-1 -my-2.5 inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md px-1 py-2.5 transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-text sm:my-0 sm:py-0 ${
                          active ? "text-foreground" : ""
                        }`}
                      >
                        {col.label}
                        <Icon
                          className={`h-3 w-3 ${
                            active ? "text-accent-text" : "opacity-40"
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
                  onClick={(e) => {
                    // Links inside the row (the name, the sector) go where
                    // they say; the rest of the row opens the holding.
                    if ((e.target as HTMLElement).closest("a")) return;
                    router.push(`/${fund}/holdings/${v.holding.id}`);
                  }}
                  className="group cursor-pointer border-b border-card-border/50 transition-colors hover:bg-highlight"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`py-3 text-xs whitespace-nowrap sm:py-3.5 sm:text-sm ${
                        col.first
                          ? "sticky left-0 z-10 bg-sticky-card px-3 transition-colors group-hover:bg-highlight sm:px-6"
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
