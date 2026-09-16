// Trade ticket card (SPEC 11.2 /trades, 11.3 /admin/tickets). Server-safe
// presentational component: shows what the ticket proposes — action, security,
// estimated size — plus who created it and the linked pitch. The pages that
// render it decide what goes in `footer`: nothing (read-only member view), a
// "Record execution" link, or the full ExecuteTicketForm on the admin page.

import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import {
  formatBondPrice,
  formatCurrency,
  formatCurrencyWhole,
  formatDate,
  formatNumber,
} from "@/lib/format";
import type { FundSlug, TradeTicket } from "@/types/domain";

const TYPE_LABELS: Record<string, string> = {
  equity: "Equity",
  etf: "ETF",
  treasury: "Treasury",
  corporate: "Corporate",
  agency_mbs: "Agency MBS",
  municipal: "Municipal",
  money_market: "Money Market",
};

export const BOND_INSTRUMENT_TYPES = [
  "treasury",
  "corporate",
  "agency_mbs",
  "municipal",
] as const;

export function isBondInstrument(instrumentType: string): boolean {
  return (BOND_INSTRUMENT_TYPES as readonly string[]).includes(instrumentType);
}

function estCell(label: string, value: ReactNode) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium tabular-nums">{value}</p>
    </div>
  );
}

export function TicketCard({
  ticket,
  fund,
  sectorName,
  pitchTitle,
  createdByName,
  footer,
}: {
  ticket: TradeTicket;
  fund: FundSlug;
  sectorName?: string | null;
  pitchTitle?: string | null;
  createdByName?: string | null;
  footer?: ReactNode;
}) {
  const bond = isBondInstrument(ticket.instrument_type);
  const estQty =
    ticket.est_quantity !== null ? Number(ticket.est_quantity) : null;
  const estPrice = ticket.est_price !== null ? Number(ticket.est_price) : null;
  const estAmount =
    ticket.est_amount !== null ? Number(ticket.est_amount) : null;

  return (
    <div className="glass-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ticket.action === "buy" ? "gain" : "loss"}>
          {ticket.action.toUpperCase()}
        </Badge>
        <Badge tone="neutral">
          {TYPE_LABELS[ticket.instrument_type] ?? ticket.instrument_type}
        </Badge>
        {sectorName && <Badge tone="accent">{sectorName}</Badge>}
        <span className="ml-auto text-xs text-muted">
          Created {formatDate(ticket.created_at)}
          {createdByName ? ` by ${createdByName}` : ""}
        </span>
      </div>

      <div className="mt-3">
        <p className="font-semibold">{ticket.name}</p>
        <p className="text-xs text-muted">
          {[
            ticket.symbol,
            ticket.cusip ? `CUSIP ${ticket.cusip}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "No symbol"}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3">
        {estCell(
          bond ? "Est face" : "Est quantity",
          estQty !== null
            ? bond
              ? formatCurrencyWhole(estQty)
              : formatNumber(estQty)
            : "—"
        )}
        {estCell(
          "Est price",
          estPrice !== null
            ? bond
              ? formatBondPrice(estPrice)
              : formatCurrency(estPrice)
            : "—"
        )}
        {estCell(
          "Est amount",
          estAmount !== null ? formatCurrency(estAmount) : "—"
        )}
      </div>

      {ticket.pitch_id && (
        <p className="mt-3 text-xs text-muted">
          From pitch{" "}
          <Link
            href={`/${fund}/pitches/${ticket.pitch_id}`}
            className="font-medium text-accent hover:underline"
          >
            {pitchTitle ?? "view pitch"}
          </Link>
        </p>
      )}

      {ticket.notes && (
        <p className="mt-2 whitespace-pre-line text-xs text-muted">
          {ticket.notes}
        </p>
      )}

      {footer && <div className="mt-4 border-t border-card-border pt-4">{footer}</div>}
    </div>
  );
}
