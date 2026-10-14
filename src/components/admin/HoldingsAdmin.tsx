"use client";

// Interactive holdings admin table: expand a row to edit or enter a mark,
// search, show only the stale bond marks, and sell or deactivate
// (SPEC 11.3). Other pages deep-link here: ?holding=<id> opens that row,
// ?stale=1 starts on the stale marks.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { SectorLink } from "@/components/ui/SectorLink";
import { HoldingForm } from "@/components/admin/HoldingForm";
import { MarkEntry } from "@/components/admin/MarkEntry";
import {
  SortButton,
  useSortedRows,
  type SortableColumn,
} from "@/components/ui/SortableTable";
import { formatBondPrice, formatDate, formatNumber } from "@/lib/format";
import type { BondMark, Holding, PricingMethod, Sector } from "@/types/domain";

type AdminSector = Pick<Sector, "id" | "name"> & { slug?: string | null };

/** What an open row shows. "both" is a deep link to a manually priced bond:
 *  the mark is usually the job, with the rest of the holding below it. */
export type HoldingPanel = "edit" | "mark" | "both";

/** One set of words for how a holding is priced, as members see it too. */
export const PRICING_LABELS: Record<PricingMethod, string> = {
  live: "live",
  treasury_curve: "curve",
  manual: "manual mark",
};

interface AdminRow {
  h: Holding;
  sectorName: string;
  markedAt: string | null;
}

/** Sort keys only — HoldingsAdmin renders its own body. */
const SORT_COLUMNS: Pick<
  SortableColumn<AdminRow>,
  "key" | "sortValue" | "defaultDir"
>[] = [
  { key: "holding", defaultDir: "asc", sortValue: (r) => r.h.symbol ?? r.h.name },
  { key: "type", defaultDir: "asc", sortValue: (r) => r.h.instrument_type },
  { key: "sector", defaultDir: "asc", sortValue: (r) => r.sectorName },
  { key: "quantity", sortValue: (r) => Number(r.h.quantity) },
  { key: "pricing", defaultDir: "asc", sortValue: (r) => r.h.pricing_method },
  // Null last, so the holdings with no mark at all surface at one end.
  { key: "mark", sortValue: (r) => r.markedAt },
];

const HEADERS: { key: string; label: string; align?: "right" }[] = [
  { key: "holding", label: "Holding" },
  { key: "type", label: "Type" },
  { key: "sector", label: "Sector" },
  { key: "quantity", label: "Qty / Face", align: "right" },
  { key: "pricing", label: "Pricing" },
  { key: "mark", label: "Latest mark" },
];

const rowButton =
  "cursor-pointer rounded-md px-2 py-1.5 text-xs font-medium text-accent-text transition-colors hover:bg-highlight";
// Below xl (phones, tablets, 1024px laptops with the sidebar) the row's
// actions sit under the pinned name, at a size a thumb can hit, instead of
// in an Actions column that only fits from about 1250px.
const phoneButton =
  "inline-flex min-h-9 cursor-pointer items-center rounded-md bg-highlight px-3 text-xs font-medium text-accent-text";

/**
 * Jump to the #section in the URL once the page has arrived. A full page
 * load streams the page in behind a loading screen, so the browser's own
 * jump can fire before the section exists.
 */
export function useScrollToHash(skip = false) {
  useEffect(() => {
    if (skip) return;
    let id = window.location.hash.slice(1);
    try {
      id = decodeURIComponent(id);
    } catch {
      // A mangled hand-typed hash (#%E0) is no section id; keep it raw.
    }
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [skip]);
}

export function HoldingsAdmin({
  fund,
  holdings,
  sectors,
  latestMarks,
  staleCutoff,
  initialHoldingId,
  initialPanel,
  initialStaleOnly = false,
}: {
  fund: string;
  holdings: Holding[];
  sectors: AdminSector[];
  /** holding_id -> latest mark */
  latestMarks: Record<string, BondMark | undefined>;
  /** Marks older than this epoch ms are stale; computed on the server. */
  staleCutoff: number;
  /** ?holding=<id>: open this row and scroll to it. */
  initialHoldingId?: string;
  /** ?mode=edit|mark; without it a manually priced bond opens both. */
  initialPanel?: "edit" | "mark";
  /** ?stale=1: start on the stale and never-marked bonds. */
  initialStaleOnly?: boolean;
}) {
  const router = useRouter();
  const deepLinked = initialHoldingId
    ? holdings.find((h) => h.id === initialHoldingId)
    : undefined;
  const [open, setOpen] = useState<{ id: string; panel: HoldingPanel } | null>(
    deepLinked
      ? {
          id: deepLinked.id,
          panel:
            initialPanel ??
            (deepLinked.pricing_method === "manual" && deepLinked.is_active
              ? "both"
              : "edit"),
        }
      : null
  );
  const [query, setQuery] = useState("");
  const [staleOnly, setStaleOnly] = useState(initialStaleOnly);

  // A deep link lands on its row rather than the top of a long table: the
  // row goes just under the table's sticky header, and the page scrolls to
  // the table. Keyed on the id so a save (which refreshes the rows) does
  // not scroll again.
  // (The page scroll goes through the card: Chrome drops a scroll margin
  // that an overflow-hidden ancestor clips.)
  const card = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const deepLinkedId = deepLinked?.id;
  useEffect(() => {
    const box = scroller.current;
    const row = deepLinkedId
      ? document.getElementById(`holding-${deepLinkedId}`)
      : null;
    if (!box || !row) return;
    const head = box.querySelector("thead")?.offsetHeight ?? 0;
    box.scrollTop = row.offsetTop - head;
    card.current?.scrollIntoView({ block: "start" });
  }, [deepLinkedId]);
  useScrollToHash(Boolean(deepLinkedId));

  // ?stale=1 is "Enter marks" on the dashboard and checklist, which adds
  // #marks: land on the filtered list (the bonds that need a mark) rather
  // than the CSV upload further down. Runs after the hash jump above, so it
  // wins; any other #section keeps its own jump.
  const list = useRef<HTMLDivElement>(null);
  const staleLanding = initialStaleOnly && !deepLinkedId;
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (staleLanding && (hash === "" || hash === "marks")) {
      list.current?.scrollIntoView({ block: "start" });
    }
  }, [staleLanding]);

  const sectorById = new Map(sectors.map((s) => [s.id, s]));
  const sectorName = (id: string | null) =>
    (id && sectorById.get(id)?.name) || "—";

  const isStale = (h: Holding) => {
    if (h.pricing_method !== "manual" || !h.is_active) return false;
    const mark = latestMarks[h.id];
    return !mark || new Date(mark.marked_at).getTime() < staleCutoff;
  };
  const staleCount = holdings.filter(isStale).length;

  const needle = query.trim().toLowerCase();
  const visible = holdings.filter((h) => {
    if (staleOnly && !isStale(h)) return false;
    if (!needle) return true;
    return [h.symbol, h.name, h.cusip, h.issuer].some((v) =>
      v?.toLowerCase().includes(needle)
    );
  });

  const rows: AdminRow[] = visible.map((h) => ({
    h,
    sectorName: sectorName(h.sector_id),
    markedAt: latestMarks[h.id]?.marked_at ?? null,
  }));
  const { sorted, sort, toggle } = useSortedRows(rows, SORT_COLUMNS, {
    key: "holding",
    dir: "asc",
  });

  async function toggleActive(h: Holding) {
    const message = h.is_active
      ? `Deactivate ${h.name}? This hides the holding without recording a sale or moving any cash. Selling it through a ticket records both.`
      : `Reactivate ${h.name}?`;
    if (!window.confirm(message)) return;
    await fetch(`/api/${fund}/holdings/${h.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !h.is_active }),
    });
    router.refresh();
  }

  return (
    <div ref={list} className="scroll-mt-20 space-y-3 lg:scroll-mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-48 flex-1 sm:max-w-xs">
          <span className="sr-only">Search holdings</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, symbol or CUSIP"
            className="w-full rounded-lg border border-input-border bg-input-bg py-2 pr-3 pl-9 text-sm outline-none transition-colors focus:border-accent"
          />
        </label>
        {(staleCount > 0 || staleOnly) && (
          <button
            type="button"
            onClick={() => setStaleOnly(!staleOnly)}
            aria-pressed={staleOnly}
            className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
              staleOnly && staleCount > 0
                ? "bg-loss/15 text-loss"
                : "bg-highlight text-foreground hover:bg-card-border"
            }`}
          >
            {staleCount === 0 ? (
              "No stale marks"
            ) : (
              <>
                <span className="tabular-nums">{staleCount}</span>
                {staleCount === 1 ? "stale mark" : "stale marks"}
              </>
            )}
            {staleOnly && <span className="text-muted">· show all</span>}
          </button>
        )}
        <p className="text-xs text-muted tabular-nums sm:ml-auto">
          {visible.length === holdings.length
            ? `${holdings.length} holdings`
            : `${visible.length} of ${holdings.length} holdings`}
        </p>
      </div>

      <div
        ref={card}
        className="glass-card scroll-mt-20 overflow-hidden lg:scroll-mt-6"
      >
        <div ref={scroller} className="max-h-[70vh] overflow-auto">
          <table className="w-full text-sm" style={{ minWidth: 640 }}>
            <thead>
              <tr className="border-b border-card-border text-left text-xs text-muted">
                {HEADERS.map((head, i) => (
                  <th
                    key={head.key}
                    scope="col"
                    aria-sort={
                      sort?.key === head.key
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    className={`sticky top-0 z-20 bg-sticky-card py-2.5 font-medium ${
                      i === 0 ? "left-0 z-30 px-4" : "px-3"
                    } ${head.align === "right" ? "text-right" : "text-left"}`}
                  >
                    <SortButton
                      label={head.label}
                      active={sort?.key === head.key}
                      dir={sort?.dir ?? "asc"}
                      onClick={() => toggle(head.key)}
                    />
                  </th>
                ))}
                <th className="sticky top-0 z-20 hidden bg-sticky-card px-3 py-2.5 text-right font-medium xl:table-cell">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-0">
                    {/* Pinned to the visible width, like the open-row panel,
                        so a phone sees the whole sentence. */}
                    <p className="sticky left-0 max-w-[calc(100vw-2.25rem)] px-4 py-8 text-center text-sm text-muted sm:max-w-[calc(100vw-3.25rem)] lg:max-w-none">
                      {staleOnly && !needle
                        ? "Every bond mark is current."
                        : "No holdings match."}
                    </p>
                  </td>
                </tr>
              )}
              {sorted.map(({ h }) => (
                <HoldingRows
                  key={h.id}
                  h={h}
                  mark={latestMarks[h.id]}
                  markStale={isStale(h)}
                  fund={fund}
                  sectors={sectors}
                  sector={h.sector_id ? sectorById.get(h.sector_id) : undefined}
                  panel={open?.id === h.id ? open.panel : null}
                  onOpen={(panel) =>
                    setOpen(
                      open?.id === h.id && open.panel === panel
                        ? null
                        : { id: h.id, panel }
                    )
                  }
                  onToggleActive={() => toggleActive(h)}
                  onDone={() => setOpen(null)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HoldingRows({
  h,
  mark,
  markStale,
  fund,
  sectors,
  sector,
  panel,
  onOpen,
  onToggleActive,
  onDone,
}: {
  h: Holding;
  mark: BondMark | undefined;
  markStale: boolean;
  fund: string;
  sectors: AdminSector[];
  sector: AdminSector | undefined;
  panel: HoldingPanel | null;
  onOpen: (panel: HoldingPanel) => void;
  onToggleActive: () => void;
  onDone: () => void;
}) {
  const canMark =
    h.is_active &&
    (h.pricing_method === "manual" || h.pricing_method === "treasury_curve");
  const sellHref = `/${fund}/admin/tickets?holding=${h.id}&action=sell`;
  return (
    <>
      <tr
        id={`holding-${h.id}`}
        className={`border-b border-card-border/50 ${
          h.is_active ? "" : "opacity-45"
        }`}
      >
        {/* min-w-44 keeps a phone's row actions to two lines. */}
        <td className="sticky left-0 z-10 min-w-44 bg-sticky-card px-4 py-2.5">
          <Link
            href={`/${fund}/holdings/${h.id}`}
            className="font-medium hover:text-accent-text hover:underline"
          >
            {h.symbol ? `${h.symbol} · ` : ""}
            {h.name}
          </Link>
          {h.cusip && <p className="text-xs text-muted">CUSIP {h.cusip}</p>}
          <div className="mt-1.5 flex flex-wrap gap-1.5 xl:hidden">
            {canMark && (
              <button
                type="button"
                onClick={() => onOpen("mark")}
                className={phoneButton}
              >
                Enter mark
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpen("edit")}
              className={phoneButton}
            >
              Edit
            </button>
            {h.is_active && (
              <Link href={sellHref} className={phoneButton}>
                Sell or close
              </Link>
            )}
          </div>
        </td>
        <td className="px-3 py-2.5 text-muted">
          {h.instrument_type.replace("_", " ")}
        </td>
        <td className="px-3 py-2.5 text-muted">
          {sector ? (
            <SectorLink fund={fund} slug={sector.slug} name={sector.name} />
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {formatNumber(Number(h.quantity), 0)}
        </td>
        <td className="px-3 py-2.5">
          <Badge
            tone={
              h.pricing_method === "live"
                ? "gain"
                : h.pricing_method === "treasury_curve"
                ? "info"
                : "neutral"
            }
          >
            {PRICING_LABELS[h.pricing_method]}
          </Badge>
        </td>
        <td className="px-3 py-2.5">
          {h.pricing_method === "manual" ? (
            mark ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                <span className={`tabular-nums ${markStale ? "text-loss" : ""}`}>
                  {formatBondPrice(Number(mark.clean_price))} ·{" "}
                  {formatDate(mark.marked_at)}
                </span>
                {markStale && <Badge tone="loss">stale</Badge>}
              </span>
            ) : (
              <Badge tone="loss">not marked</Badge>
            )
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="hidden px-3 py-2.5 text-right whitespace-nowrap xl:table-cell">
          {canMark && (
            <button
              type="button"
              onClick={() => onOpen("mark")}
              className={rowButton}
            >
              Enter mark
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpen("edit")}
            className={rowButton}
          >
            Edit
          </button>
          {h.is_active ? (
            <Link href={sellHref} className={rowButton}>
              Sell or close
            </Link>
          ) : (
            <button
              type="button"
              onClick={onToggleActive}
              className={`${rowButton} text-muted`}
            >
              Reactivate
            </button>
          )}
        </td>
      </tr>
      {panel && (
        <tr className="border-b border-card-border/50 bg-highlight/50">
          <td colSpan={7} className="p-0">
            {/* Pinned to the visible width, so on a phone the form sits
                under the row instead of trailing off the right edge. */}
            <div className="sticky left-0 max-w-[calc(100vw-2.25rem)] space-y-4 px-4 py-4 sm:max-w-[calc(100vw-3.25rem)] lg:max-w-none">
              {(panel === "mark" || panel === "both") && (
                <div>
                  {panel === "both" && (
                    <p className="mb-2 text-sm font-medium">Enter mark</p>
                  )}
                  <MarkEntry fund={fund} holding={h} onDone={onDone} />
                </div>
              )}
              {(panel === "edit" || panel === "both") && (
                <div>
                  {panel === "both" && (
                    <p className="mb-2 text-sm font-medium">Edit holding</p>
                  )}
                  <HoldingForm
                    fund={fund}
                    sectors={sectors}
                    holding={h}
                    onDone={onDone}
                  />
                  <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-card-border pt-3">
                    {h.is_active ? (
                      <>
                        <p className="min-w-0 flex-1 text-xs text-muted">
                          To close this position,{" "}
                          <Link
                            href={sellHref}
                            className="font-medium text-accent-text hover:underline"
                          >
                            sell it through a ticket
                          </Link>
                          : the ticket records the trade and the cash.
                          Deactivate only hides the holding, for fixing a
                          mistake.
                        </p>
                        <button
                          type="button"
                          onClick={onToggleActive}
                          className="min-h-9 cursor-pointer rounded-md px-3 text-xs font-medium text-muted transition-colors hover:bg-loss/10 hover:text-loss"
                        >
                          Deactivate
                        </button>
                      </>
                    ) : (
                      <>
                        <p className="min-w-0 flex-1 text-xs text-muted">
                          This holding is inactive and does not appear on Holdings.
                        </p>
                        <button
                          type="button"
                          onClick={onToggleActive}
                          className="min-h-9 cursor-pointer rounded-md px-3 text-xs font-medium text-accent-text transition-colors hover:bg-highlight"
                        >
                          Reactivate
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
