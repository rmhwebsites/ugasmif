"use client";

// Record-execution form for one pending ticket (SPEC 11.3). Fill fields per
// the spec — quantity, price, accrued interest (bond instruments only),
// commission, trade date, settlement date, broker reference, notes — with a
// live PREVIEW of the holding and cash after the fill (mirrors the math in
// the execute_ticket RPC exactly), and a cancel flow that requires a reason.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isBondInstrument } from "@/components/trades/TicketCard";
import {
  easternDateString,
  formatBondPrice,
  formatCurrency,
  formatCurrencyWhole,
  formatNumber,
} from "@/lib/format";
import type { FundSlug, TradeAction } from "@/types/domain";

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent";
const labelClass = "mb-1 block text-xs font-medium text-muted";

function parseNum(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function ExecuteTicketForm({
  fund,
  ticketId,
  action,
  instrumentType,
  /** Current position quantity (0 for a brand-new buy). */
  holdingQuantity,
  /** Current avg cost (per share, or per 100 face for bonds). */
  holdingAvgCost,
  /** The fund's current cash balance. */
  cashBalance,
  estQuantity,
  estPrice,
}: {
  fund: FundSlug;
  ticketId: string;
  action: TradeAction;
  instrumentType: string;
  holdingQuantity: number;
  holdingAvgCost: number;
  cashBalance: number;
  estQuantity: number | null;
  estPrice: number | null;
}) {
  const router = useRouter();
  const bond = isBondInstrument(instrumentType);

  const [quantity, setQuantity] = useState(
    estQuantity !== null ? String(estQuantity) : ""
  );
  const [price, setPrice] = useState(estPrice !== null ? String(estPrice) : "");
  const [accrued, setAccrued] = useState("");
  const [commission, setCommission] = useState("");
  const [tradeDate, setTradeDate] = useState(easternDateString());
  const [settlementDate, setSettlementDate] = useState("");
  const [brokerRef, setBrokerRef] = useState("");
  const [notes, setNotes] = useState("");

  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [busy, setBusy] = useState<"execute" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // ── Preview (same math as the execute_ticket RPC) ─────────────────────────
  const preview = useMemo(() => {
    const q = parseNum(quantity);
    const p = parseNum(price);
    if (q === null || p === null || q <= 0 || p <= 0) return null;
    const acc = bond ? Math.abs(parseNum(accrued) ?? 0) : 0;
    const comm = Math.abs(parseNum(commission) ?? 0);
    // Bond prices are per 100 face; quantity is face value in dollars.
    const principal = bond ? (q * p) / 100 : q * p;
    const newQuantity =
      action === "buy" ? holdingQuantity + q : holdingQuantity - q;
    const newAvgCost =
      action === "buy" && newQuantity > 0
        ? (holdingQuantity * holdingAvgCost + q * p) / newQuantity
        : holdingAvgCost;
    const cashAfter =
      action === "buy"
        ? cashBalance - (principal + acc + comm)
        : cashBalance + principal + acc - comm;
    return { principal, newQuantity, newAvgCost, cashAfter, oversell: newQuantity < 0 };
  }, [
    quantity,
    price,
    accrued,
    commission,
    bond,
    action,
    holdingQuantity,
    holdingAvgCost,
    cashBalance,
  ]);

  async function submit(
    kind: "execute" | "cancel",
    url: string,
    body: unknown
  ) {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "The request failed. Try again.");
        return;
      }
      setDone(kind === "execute" ? "Trade executed." : "Ticket cancelled.");
      router.refresh();
    } catch {
      setError("Network error — the request did not go through.");
    } finally {
      setBusy(null);
    }
  }

  function handleExecute(e: React.FormEvent) {
    e.preventDefault();
    const q = parseNum(quantity);
    const p = parseNum(price);
    if (q === null || q <= 0) {
      setError("Fill quantity must be a positive number.");
      return;
    }
    if (p === null || p <= 0) {
      setError("Fill price must be a positive number.");
      return;
    }
    if (!tradeDate) {
      setError("Trade date is required.");
      return;
    }
    void submit("execute", `/api/${fund}/tickets/${ticketId}/execute`, {
      fill_quantity: q,
      fill_price: p,
      accrued_interest: bond ? Math.abs(parseNum(accrued) ?? 0) : 0,
      commission: Math.abs(parseNum(commission) ?? 0),
      trade_date: tradeDate,
      settlement_date: settlementDate || null,
      broker_reference: brokerRef.trim() || null,
      notes: notes.trim() || null,
    });
  }

  function handleCancel() {
    if (!cancelReason.trim()) {
      setError("A cancellation reason is required.");
      return;
    }
    void submit("cancel", `/api/${fund}/tickets/${ticketId}/cancel`, {
      reason: cancelReason.trim(),
    });
  }

  if (done) {
    return (
      <p className="flex items-center gap-2 text-sm text-gain">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {done}
      </p>
    );
  }

  return (
    <form onSubmit={handleExecute} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor={`qty-${ticketId}`} className={labelClass}>
            {bond ? "Fill face value ($)" : "Fill quantity"}
          </label>
          <input
            id={`qty-${ticketId}`}
            type="number"
            step="any"
            min="0"
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`price-${ticketId}`} className={labelClass}>
            {bond ? "Fill price (per 100)" : "Fill price ($)"}
          </label>
          <input
            id={`price-${ticketId}`}
            type="number"
            step="any"
            min="0"
            required
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
          />
        </div>
        {bond && (
          <div>
            <label htmlFor={`accrued-${ticketId}`} className={labelClass}>
              Accrued interest ($)
            </label>
            <input
              id={`accrued-${ticketId}`}
              type="number"
              step="any"
              min="0"
              value={accrued}
              onChange={(e) => setAccrued(e.target.value)}
              className={inputClass}
            />
          </div>
        )}
        <div>
          <label htmlFor={`comm-${ticketId}`} className={labelClass}>
            Commission ($)
          </label>
          <input
            id={`comm-${ticketId}`}
            type="number"
            step="any"
            min="0"
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`tdate-${ticketId}`} className={labelClass}>
            Trade date
          </label>
          <input
            id={`tdate-${ticketId}`}
            type="date"
            required
            value={tradeDate}
            onChange={(e) => setTradeDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`sdate-${ticketId}`} className={labelClass}>
            Settlement date
          </label>
          <input
            id={`sdate-${ticketId}`}
            type="date"
            value={settlementDate}
            onChange={(e) => setSettlementDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`broker-${ticketId}`} className={labelClass}>
            Broker reference
          </label>
          <input
            id={`broker-${ticketId}`}
            type="text"
            value={brokerRef}
            onChange={(e) => setBrokerRef(e.target.value)}
            placeholder="Confirmation #"
            className={inputClass}
          />
        </div>
        <div className="col-span-2">
          <label htmlFor={`notes-${ticketId}`} className={labelClass}>
            Notes
          </label>
          <input
            id={`notes-${ticketId}`}
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-lg bg-highlight p-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted">
          Preview
        </p>
        {preview ? (
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">
                Principal
              </p>
              <p className="text-sm font-medium tabular-nums">
                {formatCurrency(preview.principal)}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">
                {bond ? "New face" : "New quantity"}
              </p>
              <p
                className={`text-sm font-medium tabular-nums ${
                  preview.oversell ? "text-loss" : ""
                }`}
              >
                {bond
                  ? formatCurrencyWhole(preview.newQuantity)
                  : formatNumber(preview.newQuantity, 2)}
              </p>
            </div>
            {action === "buy" && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted">
                  New avg cost
                </p>
                <p className="text-sm font-medium tabular-nums">
                  {bond
                    ? formatBondPrice(preview.newAvgCost)
                    : formatCurrency(preview.newAvgCost)}
                </p>
              </div>
            )}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted">
                Cash after
              </p>
              <p
                className={`text-sm font-medium tabular-nums ${
                  preview.cashAfter < 0 ? "text-loss" : ""
                }`}
              >
                {formatCurrency(preview.cashAfter)}
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted">
            Enter a fill quantity and price to preview the holding and cash
            after execution.
          </p>
        )}
        {preview?.oversell && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-loss">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            Sell quantity exceeds the current position (
            {bond
              ? formatCurrencyWhole(holdingQuantity)
              : formatNumber(holdingQuantity, 2)}
            ) — the execution will be rejected.
          </p>
        )}
        {preview && preview.cashAfter < 0 && !preview.oversell && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-loss">
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
            This fill takes the fund&apos;s cash balance below zero.
          </p>
        )}
      </div>

      {error && <p className="text-sm text-loss">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy !== null}>
          {busy === "execute" ? "Recording…" : "Record execution"}
        </Button>
        {!showCancel ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setShowCancel(true)}
          >
            Cancel ticket…
          </Button>
        ) : (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancelling (required)"
              aria-label="Cancellation reason"
              className={`${inputClass} min-w-[200px] flex-1`}
            />
            <Button
              type="button"
              variant="danger"
              disabled={busy !== null || cancelReason.trim() === ""}
              onClick={handleCancel}
            >
              {busy === "cancel" ? "Cancelling…" : "Confirm cancel"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setShowCancel(false);
                setCancelReason("");
              }}
            >
              Keep ticket
            </Button>
          </div>
        )}
      </div>
    </form>
  );
}
