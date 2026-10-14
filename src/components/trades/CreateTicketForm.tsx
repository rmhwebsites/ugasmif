"use client";

// Direct no-pitch ticket form (SPEC 11.3): for rebalances, corporate actions,
// advisor-directed trades, and selling or closing a position. A reason is
// always required and is stored on the ticket's notes. Listed securities go
// by symbol; bonds and anything unlisted by name + CUSIP. Sells must match an
// existing holding (the API enforces it so the ticket is executable later),
// so the form leads with a holding picker: choosing one fills the security,
// and on a sell the full quantity, which closes the position once the
// execution is recorded (the ledger and cash move with it).
//
// /[fund]/admin/tickets?action=sell&holding=<id> opens with that holding
// chosen and scrolls here.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/lib/format";
import type { FundSlug, InstrumentType, TradeAction } from "@/types/domain";

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent";
/** Fields the chosen holding fills in, shown as set rather than editable. */
const lockedClass =
  "w-full rounded-lg border border-input-border bg-highlight px-3 py-2 text-sm text-muted outline-none";
const labelClass = "mb-1 block text-xs font-medium text-muted";

const INSTRUMENT_OPTIONS: { value: InstrumentType; label: string }[] = [
  { value: "equity", label: "Equity" },
  { value: "etf", label: "ETF" },
  { value: "treasury", label: "Treasury" },
  { value: "corporate", label: "Corporate" },
  { value: "agency_mbs", label: "Agency MBS" },
  { value: "municipal", label: "Municipal" },
  { value: "money_market", label: "Money market" },
];

/** An active position the ticket can sell from or add to. */
export interface TicketHolding {
  id: string;
  name: string;
  symbol: string | null;
  cusip: string | null;
  sector_id: string | null;
  instrument_type: InstrumentType;
  quantity: number;
}

function holdingLabel(h: TicketHolding): string {
  const qty = formatNumber(Number(h.quantity), Number(h.quantity) % 1 ? 2 : 0);
  return `${h.symbol ? `${h.symbol} · ` : ""}${h.name} (${qty})`;
}

export function CreateTicketForm({
  fund,
  sectors,
  defaultInstrumentType,
  holdings = [],
  initial,
}: {
  fund: FundSlug;
  sectors: { id: string; name: string }[];
  /** "equity" for Athena, "treasury" for Arch. */
  defaultInstrumentType: InstrumentType;
  /** Active holdings, for the picker. */
  holdings?: TicketHolding[];
  /** Prefill from the URL, e.g. a "Sell or close" link on a holding. */
  initial?: { action?: TradeAction; holdingId?: string | null };
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  const initialHolding =
    holdings.find((h) => h.id === initial?.holdingId) ?? null;
  const initialAction: TradeAction = initial?.action ?? "buy";

  const [action, setAction] = useState<TradeAction>(initialAction);
  const [holdingId, setHoldingId] = useState(initialHolding?.id ?? "");
  const [instrumentType, setInstrumentType] = useState<InstrumentType>(
    initialHolding?.instrument_type ?? defaultInstrumentType
  );
  const [symbol, setSymbol] = useState(initialHolding?.symbol ?? "");
  const [name, setName] = useState(initialHolding?.name ?? "");
  const [cusip, setCusip] = useState(initialHolding?.cusip ?? "");
  const [sectorId, setSectorId] = useState(initialHolding?.sector_id ?? "");
  const [estQuantity, setEstQuantity] = useState(
    initialHolding && initialAction === "sell"
      ? String(Number(initialHolding.quantity))
      : ""
  );
  const [estPrice, setEstPrice] = useState("");
  const [estAmount, setEstAmount] = useState("");
  const [reason, setReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const chosen = holdings.find((h) => h.id === holdingId) ?? null;
  const closesPosition =
    action === "sell" &&
    chosen !== null &&
    Number(estQuantity) === Number(chosen.quantity);

  // Arriving from a holding's "Sell or close" link: bring the form into
  // view and put the cursor on the one field left to fill. Once, on
  // arrival; later picks don't scroll.
  const arrivedWithHolding = useRef(initialHolding !== null);
  useEffect(() => {
    if (!arrivedWithHolding.current) return;
    formRef.current?.scrollIntoView({ block: "start" });
    reasonRef.current?.focus({ preventScroll: true });
  }, []);

  function chooseHolding(id: string) {
    setHoldingId(id);
    const h = holdings.find((x) => x.id === id);
    if (!h) {
      // Back to a new security: clear what the holding filled in.
      setInstrumentType(defaultInstrumentType);
      setSymbol("");
      setName("");
      setCusip("");
      setSectorId("");
      setEstQuantity("");
      return;
    }
    setInstrumentType(h.instrument_type);
    setSymbol(h.symbol ?? "");
    setName(h.name);
    setCusip(h.cusip ?? "");
    setSectorId(h.sector_id ?? "");
    setEstQuantity(action === "sell" ? String(Number(h.quantity)) : "");
  }

  function changeAction(next: TradeAction) {
    setAction(next);
    if (chosen && next === "sell" && estQuantity.trim() === "") {
      setEstQuantity(String(Number(chosen.quantity)));
    }
  }

  function num(value: string): number | undefined {
    if (value.trim() === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (action === "sell" && holdings.length > 0 && !chosen) {
      setError("Choose the holding to sell.");
      return;
    }
    if (!symbol.trim() && !name.trim()) {
      setError("Enter a symbol (listed securities) or a name (bonds).");
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required for a direct ticket.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/${fund}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          instrument_type: instrumentType,
          symbol: symbol.trim() || undefined,
          name: name.trim() || undefined,
          cusip: cusip.trim() || undefined,
          sector_id: sectorId || undefined,
          est_quantity: num(estQuantity),
          est_price: num(estPrice),
          est_amount: num(estAmount),
          reason: reason.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create the ticket. Try again.");
        return;
      }
      setSuccess(
        "Ticket created. It is now under Pending tickets, ready to record execution."
      );
      setHoldingId("");
      setSymbol("");
      setName("");
      setCusip("");
      setSectorId("");
      setEstQuantity("");
      setEstPrice("");
      setEstAmount("");
      setReason("");
      router.refresh();
    } catch {
      setError("Network error. The request did not go through.");
    } finally {
      setBusy(false);
    }
  }

  // With a holding chosen, the security is the holding's; the picker is the
  // way to change it.
  const locked = chosen !== null;

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="scroll-mt-20 space-y-4 lg:scroll-mt-6"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="ct-action" className={labelClass}>
            Action
          </label>
          <select
            id="ct-action"
            value={action}
            onChange={(e) => changeAction(e.target.value as TradeAction)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </div>
        {holdings.length > 0 && (
          <div className="col-span-2">
            <label htmlFor="ct-holding" className={labelClass}>
              Holding
            </label>
            <select
              id="ct-holding"
              value={holdingId}
              onChange={(e) => chooseHolding(e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">
                {action === "sell"
                  ? "Choose the holding to sell"
                  : "New security (not held yet)"}
              </option>
              {holdings.map((h) => (
                <option key={h.id} value={h.id}>
                  {holdingLabel(h)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {action === "sell" && (
        <p className="text-xs text-muted">
          {closesPosition
            ? "Selling the full quantity closes the position when you record the execution. The trade and the cash are recorded with it."
            : "To close a position, sell the full quantity. The holding closes when you record the execution."}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="ct-type" className={labelClass}>
            Instrument type
          </label>
          <select
            id="ct-type"
            value={instrumentType}
            disabled={locked}
            onChange={(e) =>
              setInstrumentType(e.target.value as InstrumentType)
            }
            className={locked ? lockedClass : `${inputClass} cursor-pointer`}
          >
            {INSTRUMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ct-sector" className={labelClass}>
            Sector
          </label>
          <select
            id="ct-sector"
            value={sectorId}
            disabled={locked}
            onChange={(e) => setSectorId(e.target.value)}
            className={locked ? lockedClass : `${inputClass} cursor-pointer`}
          >
            <option value="">No sector</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ct-symbol" className={labelClass}>
            Symbol
          </label>
          <input
            id="ct-symbol"
            type="text"
            value={symbol}
            readOnly={locked}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="e.g. GD"
            className={locked ? lockedClass : inputClass}
          />
        </div>
        <div>
          <label htmlFor="ct-name" className={labelClass}>
            Name (bonds / unlisted)
          </label>
          <input
            id="ct-name"
            type="text"
            value={name}
            readOnly={locked}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. UST 4.25 05/2034"
            className={locked ? lockedClass : inputClass}
          />
        </div>
        <div>
          <label htmlFor="ct-cusip" className={labelClass}>
            CUSIP
          </label>
          <input
            id="ct-cusip"
            type="text"
            value={cusip}
            readOnly={locked}
            onChange={(e) => setCusip(e.target.value.toUpperCase())}
            className={locked ? lockedClass : inputClass}
          />
        </div>
        <div>
          <label htmlFor="ct-qty" className={labelClass}>
            Est quantity / face
          </label>
          <input
            id="ct-qty"
            type="number"
            step="any"
            min="0"
            value={estQuantity}
            onChange={(e) => setEstQuantity(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ct-price" className={labelClass}>
            Est price
          </label>
          <input
            id="ct-price"
            type="number"
            step="any"
            min="0"
            value={estPrice}
            onChange={(e) => setEstPrice(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ct-amount" className={labelClass}>
            Est amount ($)
          </label>
          <input
            id="ct-amount"
            type="number"
            step="any"
            min="0"
            value={estAmount}
            onChange={(e) => setEstAmount(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="ct-reason" className={labelClass}>
          Reason (required)
        </label>
        <textarea
          id="ct-reason"
          ref={reasonRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={2}
          placeholder="e.g. closing the position, rebalance, corporate action, advisor-directed"
          className={inputClass}
        />
      </div>

      {error && <p className="text-sm text-loss">{error}</p>}
      {success && (
        <p className="flex items-center gap-2 text-sm text-gain">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {success}
        </p>
      )}

      <Button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Create ticket"}
      </Button>
    </form>
  );
}
