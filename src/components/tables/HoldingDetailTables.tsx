"use client";

// The two data tables on /[fund]/holdings/[id] (SPEC 11.2): the position's
// trade history and, for a manually marked bond, its mark history. Client
// islands so the columns sort; the page loads and joins on the server.
// A trade that came from a pitch links to it, so a position can be traced
// back to the case that was made for it.
//
// The cash-flow schedule stays on the page unsorted: a coupon schedule read
// out of date order is not a schedule.

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import {
  SortableTable,
  type SortableColumn,
} from "@/components/ui/SortableTable";
import {
  formatBondPrice,
  formatCurrency,
  formatCurrencyWhole,
  formatDate,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import type { BondMark, Trade } from "@/types/domain";

function spreadLabel(bp: number | null): string {
  if (bp === null || !Number.isFinite(bp)) return "—";
  const rounded = Math.round(bp);
  return `${rounded >= 0 ? "+" : ""}${rounded} bp`;
}

// ── Trade history ───────────────────────────────────────────────────────────

/** The pitch behind a trade, keyed by the trade's ticket id. */
export interface TradePitch {
  id: string;
  title: string;
}

function tradeColumns(
  isBond: boolean,
  fund: string,
  pitchByTicket: Record<string, TradePitch>
): SortableColumn<Trade>[] {
  const pitchOf = (t: Trade) =>
    t.ticket_id ? pitchByTicket[t.ticket_id] ?? null : null;
  const columns: SortableColumn<Trade>[] = [
    {
      key: "date",
      label: "Date",
      align: "left",
      sortValue: (t) => t.trade_date ?? "",
      render: (t) => (
        <span className="whitespace-nowrap">{formatDate(t.trade_date)}</span>
      ),
    },
    {
      key: "action",
      label: "Action",
      align: "left",
      defaultDir: "asc",
      sortValue: (t) => t.action,
      render: (t) => (
        <Badge tone={t.action === "buy" ? "gain" : "loss"}>{t.action}</Badge>
      ),
    },
    {
      key: "quantity",
      label: isBond ? "Face" : "Shares",
      sortValue: (t) => Number(t.quantity),
      render: (t) => (
        <span className="tabular-nums">
          {isBond
            ? formatCurrencyWhole(Number(t.quantity))
            : formatNumber(Number(t.quantity))}
        </span>
      ),
    },
    {
      key: "price",
      label: "Price",
      sortValue: (t) => Number(t.price),
      render: (t) => (
        <span className="tabular-nums">
          {isBond
            ? formatBondPrice(Number(t.price))
            : formatCurrency(Number(t.price))}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Amount",
      sortValue: (t) => Number(t.amount),
      render: (t) => (
        <span className="font-medium tabular-nums">
          {formatCurrency(Number(t.amount))}
        </span>
      ),
    },
    {
      key: "commission",
      label: "Commission",
      className: "hidden sm:table-cell",
      sortValue: (t) => Number(t.commission),
      render: (t) => (
        <span className="tabular-nums text-muted">
          {formatCurrency(Number(t.commission))}
        </span>
      ),
    },
  ];
  // Only when some trade has a pitch: a column of dashes says nothing.
  if (Object.keys(pitchByTicket).length > 0) {
    columns.push({
      key: "pitch",
      label: "Pitch",
      align: "left",
      defaultDir: "asc",
      sortValue: (t) => pitchOf(t)?.title ?? null,
      render: (t) => {
        const pitch = pitchOf(t);
        if (!pitch) return <span className="text-muted">—</span>;
        return (
          <Link
            href={`/${fund}/pitches/${pitch.id}`}
            className="block max-w-[220px] truncate font-medium text-accent-text hover:underline"
          >
            {pitch.title}
          </Link>
        );
      },
    });
  }
  return columns;
}

export function HoldingTradesTable({
  trades,
  isBond,
  fund,
  pitchByTicket = {},
}: {
  trades: Trade[];
  isBond: boolean;
  fund: string;
  /** ticket id → the pitch that ticket came from. */
  pitchByTicket?: Record<string, TradePitch>;
}) {
  const hasPitch = trades.some(
    (t) => t.ticket_id !== null && pitchByTicket[t.ticket_id] !== undefined
  );
  return (
    <SortableTable
      rows={trades}
      columns={tradeColumns(isBond, fund, hasPitch ? pitchByTicket : {})}
      rowKey={(t) => t.id}
      initialSort={{ key: "date", dir: "desc" }}
      minWidth={560}
      caption="Trades for this holding"
      emptyMessage="No trades recorded for this holding yet. Executed tickets will show up here."
    />
  );
}

// ── Mark history ────────────────────────────────────────────────────────────

export interface MarkRow extends BondMark {
  /** Mark YTM minus the interpolated Treasury par yield, in basis points. */
  spreadBp: number | null;
  sourceLabel: string;
}

const markColumns: SortableColumn<MarkRow>[] = [
  {
    key: "marked",
    label: "Marked",
    align: "left",
    sortValue: (m) => m.marked_at,
    render: (m) => formatDate(m.marked_at),
  },
  {
    key: "price",
    label: "Clean price",
    sortValue: (m) => Number(m.clean_price),
    render: (m) => (
      <span className="font-medium tabular-nums">
        {formatBondPrice(Number(m.clean_price))}
      </span>
    ),
  },
  {
    key: "ytm",
    label: "YTM",
    sortValue: (m) => (m.ytm !== null ? Number(m.ytm) : null),
    render: (m) => (
      <span className="tabular-nums">
        {formatPercent(m.ytm !== null ? Number(m.ytm) : null, 2)}
      </span>
    ),
  },
  {
    key: "duration",
    label: "Dur",
    sortValue: (m) => (m.duration !== null ? Number(m.duration) : null),
    render: (m) => (
      <span className="tabular-nums text-muted">
        {m.duration !== null ? formatNumber(Number(m.duration), 1) : "—"}
      </span>
    ),
  },
  {
    key: "spread",
    label: (
      <span title="Mark YTM minus the interpolated Treasury par yield at the holding's benchmark tenor, on the nearest prior curve date.">
        Sprd vs Tsy
      </span>
    ),
    sortValue: (m) => m.spreadBp,
    render: (m) => (
      <span className="tabular-nums text-muted">{spreadLabel(m.spreadBp)}</span>
    ),
  },
  {
    key: "source",
    label: "Source",
    align: "left",
    defaultDir: "asc",
    sortValue: (m) => m.sourceLabel,
    render: (m) => <span className="text-muted">{m.sourceLabel}</span>,
  },
  {
    key: "notes",
    label: "Notes",
    align: "left",
    className: "hidden md:table-cell",
    render: (m) => (
      <span className="block max-w-[200px] truncate text-muted">
        {m.notes ?? "—"}
      </span>
    ),
  },
];

export function MarkHistoryTable({ marks }: { marks: MarkRow[] }) {
  return (
    <SortableTable
      rows={marks}
      columns={markColumns}
      rowKey={(m) => m.id}
      initialSort={{ key: "marked", dir: "desc" }}
      minWidth={640}
      caption="Mark history"
    />
  );
}
