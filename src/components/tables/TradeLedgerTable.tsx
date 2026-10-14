"use client";

// The immutable trade ledger (SPEC 11.2). A client island so the columns
// sort: the page filters on the server and joins the security, executor and
// pitch names in before handing the rows down.
//
// The security is what names a row, so it is the column that stays put on a
// sideways scroll. On a phone the date and buy/sell columns fold into a
// second line under the ticker, which leaves the numbers beside it.

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { isBondInstrument } from "@/components/trades/TicketCard";
import { SecurityLogo } from "@/components/holdings/SecurityLogo";
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
  /** The pitch behind the ticket this trade filled, if there was one. */
  pitch: { id: string; title: string } | null;
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
        <span className="whitespace-nowrap tabular-nums">
          {dateOnly(t.trade_date)}
        </span>
      ),
      className: "hidden sm:table-cell",
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
      className: "hidden sm:table-cell",
    },
    {
      key: "security",
      label: "Security",
      align: "left",
      defaultDir: "asc",
      sortValue: (t) => t.holding?.symbol ?? t.holding?.name ?? "",
      render: (t) => (
        <>
          {t.holding ? (
            <Link
              href={`/${fund}/holdings/${t.holding.id}`}
              className="flex items-center gap-2 hover:underline"
            >
              <SecurityLogo
                symbol={t.holding.symbol}
                name={t.holding.name}
                size="sm"
              />
              <span className="min-w-0">
                <span className="block font-semibold">
                  {t.holding.symbol ?? t.holding.name}
                </span>
                {t.holding.symbol && (
                  <span className="block max-w-[120px] truncate text-[10px] text-muted sm:max-w-[180px] sm:text-xs">
                    {t.holding.name}
                  </span>
                )}
              </span>
            </Link>
          ) : (
            <span className="text-muted">—</span>
          )}
          {/* Phone only: the date and action columns are hidden there. The
              indent lines it up under the ticker, past the logo. */}
          <span
            className={`mt-1 flex items-center gap-1.5 whitespace-nowrap text-[10px] text-muted tabular-nums sm:hidden ${
              t.holding ? "pl-7" : ""
            }`}
          >
            <span
              className={`font-semibold ${
                t.action === "buy" ? "text-gain" : "text-loss"
              }`}
            >
              {t.action.toUpperCase()}
            </span>
            {dateOnly(t.trade_date)}
          </span>
        </>
      ),
      // The edge padding the hidden date column has on wider screens.
      className: "max-sm:pl-3",
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
          {t.pitch && (
            <span className="block truncate">
              From pitch{" "}
              <Link
                href={`/${fund}/pitches/${t.pitch.id}`}
                className="font-medium text-accent-text hover:underline"
                title={t.pitch.title}
              >
                {t.pitch.title}
              </Link>
            </span>
          )}
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
          {!t.pitch && !t.reverses_trade_id && !t.notes && "—"}
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
      stickyKey="security"
      minWidth={1000}
      maxHeight="70vh"
      caption="Trade ledger"
    />
  );
}
