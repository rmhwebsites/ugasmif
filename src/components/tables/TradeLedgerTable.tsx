"use client";

// The immutable trade ledger (SPEC 11.2). A client island so the columns
// sort: the page filters on the server and joins the security and executor
// names in before handing the rows down.

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { isBondInstrument } from "@/components/trades/TicketCard";
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
} from "@/lib/format";
import type { InstrumentType, Trade } from "@/types/domain";

export interface LedgerRow extends Trade {
  holding: {
    id: string;
    symbol: string | null;
    name: string;
    instrument_type: InstrumentType;
  } | null;
  executedByName: string | null;
}

/** Date-only strings render at noon UTC so ET display never slips a day. */
function dateOnly(d: string | null): string {
  return d ? formatDate(`${d}T12:00:00Z`) : "—";
}

const isBond = (r: LedgerRow) =>
  r.holding ? isBondInstrument(r.holding.instrument_type) : false;

function buildColumns(fund: string): SortableColumn<LedgerRow>[] {
  return [
    {
      key: "date",
      label: "Date",
      align: "left",
      sortValue: (t) => t.trade_date ?? "",
      render: (t) => (
        <span className="tabular-nums">{dateOnly(t.trade_date)}</span>
      ),
    },
    {
      key: "action",
      label: "Action",
      align: "left",
      defaultDir: "asc",
      sortValue: (t) => t.action,
      render: (t) => (
        <Badge tone={t.action === "buy" ? "gain" : "loss"}>
          {t.action.toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "security",
      label: "Security",
      align: "left",
      defaultDir: "asc",
      sortValue: (t) => t.holding?.symbol ?? t.holding?.name ?? "",
      render: (t) =>
        t.holding ? (
          <Link
            href={`/${fund}/holdings/${t.holding.id}`}
            className="block hover:underline"
          >
            <span className="font-semibold">
              {t.holding.symbol ?? t.holding.name}
            </span>
            {t.holding.symbol && (
              <span className="block max-w-[180px] truncate text-[10px] text-muted sm:text-xs">
                {t.holding.name}
              </span>
            )}
          </Link>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: "quantity",
      label: "Quantity",
      sortValue: (t) => Number(t.quantity),
      render: (t) => (
        <span className="tabular-nums">
          {isBond(t)
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
          {isBond(t)
            ? formatBondPrice(Number(t.price))
            : formatCurrency(Number(t.price))}
        </span>
      ),
    },
    {
      key: "amount",
      label: "Principal",
      sortValue: (t) => Number(t.amount),
      render: (t) => (
        <span className="font-medium tabular-nums">
          {formatCurrency(Number(t.amount))}
        </span>
      ),
    },
    {
      key: "accrued",
      label: "Accrued",
      sortValue: (t) => Number(t.accrued_interest),
      render: (t) => (
        <span className="tabular-nums text-muted">
          {Number(t.accrued_interest) !== 0
            ? formatCurrency(Number(t.accrued_interest))
            : "—"}
        </span>
      ),
    },
    {
      key: "commission",
      label: "Commission",
      sortValue: (t) => Number(t.commission),
      render: (t) => (
        <span className="tabular-nums text-muted">
          {Number(t.commission) !== 0
            ? formatCurrency(Number(t.commission))
            : "—"}
        </span>
      ),
    },
    {
      key: "executedBy",
      label: "Executed by",
      align: "left",
      defaultDir: "asc",
      sortValue: (t) => t.executedByName ?? "",
      render: (t) => (
        <span className="block max-w-[140px] truncate text-muted">
          {t.executedByName ?? "—"}
        </span>
      ),
    },
    {
      key: "notes",
      label: "Notes",
      align: "left",
      render: (t) => (
        <div className="max-w-[240px] space-y-1 text-muted">
          {t.reverses_trade_id && (
            <Badge
              tone="warn"
              title={`This correction row reverses trade ${t.reverses_trade_id}`}
            >
              reverses trade {t.reverses_trade_id.slice(0, 8)}
            </Badge>
          )}
          {t.notes && (
            <span className="block truncate" title={t.notes}>
              {t.notes}
            </span>
          )}
          {!t.reverses_trade_id && !t.notes && "—"}
        </div>
      ),
    },
  ];
}

export function TradeLedgerTable({
  fund,
  trades,
}: {
  fund: string;
  trades: LedgerRow[];
}) {
  return (
    <SortableTable
      rows={trades}
      columns={buildColumns(fund)}
      rowKey={(t) => t.id}
      initialSort={{ key: "date", dir: "desc" }}
      minWidth={1000}
      maxHeight="70vh"
      caption="Trade ledger"
    />
  );
}
