"use client";

// Direct no-pitch ticket form (SPEC 11.3): for rebalances, corporate actions,
// or advisor-directed trades. A reason is always required and is stored on
// the ticket's notes. Listed securities go by symbol; bonds and anything
// unlisted by name + CUSIP. Sells must match an existing holding (the API
// enforces it so the ticket is executable later).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { FundSlug, InstrumentType, TradeAction } from "@/types/domain";

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent";
const labelClass = "mb-1 block text-xs font-medium text-muted";

const INSTRUMENT_OPTIONS: { value: InstrumentType; label: string }[] = [
  { value: "equity", label: "Equity" },
  { value: "etf", label: "ETF" },
  { value: "treasury", label: "Treasury" },
  { value: "corporate", label: "Corporate" },
  { value: "agency_mbs", label: "Agency MBS" },
  { value: "municipal", label: "Municipal" },
  { value: "money_market", label: "Money Market" },
];

export function CreateTicketForm({
  fund,
  sectors,
  defaultInstrumentType,
}: {
  fund: FundSlug;
  sectors: { id: string; name: string }[];
  /** "equity" for Athena, "treasury" for Arch. */
  defaultInstrumentType: InstrumentType;
}) {
  const router = useRouter();
  const [action, setAction] = useState<TradeAction>("buy");
  const [instrumentType, setInstrumentType] = useState<InstrumentType>(
    defaultInstrumentType
  );
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [cusip, setCusip] = useState("");
  const [sectorId, setSectorId] = useState("");
  const [estQuantity, setEstQuantity] = useState("");
  const [estPrice, setEstPrice] = useState("");
  const [estAmount, setEstAmount] = useState("");
  const [reason, setReason] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function num(value: string): number | undefined {
    if (value.trim() === "") return undefined;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
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
      setSuccess("Ticket created — it is now pending above.");
      setSymbol("");
      setName("");
      setCusip("");
      setEstQuantity("");
      setEstPrice("");
      setEstAmount("");
      setReason("");
      router.refresh();
    } catch {
      setError("Network error — the request did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="ct-action" className={labelClass}>
            Action
          </label>
          <select
            id="ct-action"
            value={action}
            onChange={(e) => setAction(e.target.value as TradeAction)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </div>
        <div>
          <label htmlFor="ct-type" className={labelClass}>
            Instrument type
          </label>
          <select
            id="ct-type"
            value={instrumentType}
            onChange={(e) =>
              setInstrumentType(e.target.value as InstrumentType)
            }
            className={`${inputClass} cursor-pointer`}
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
            onChange={(e) => setSectorId(e.target.value)}
            className={`${inputClass} cursor-pointer`}
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
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="e.g. GD"
            className={inputClass}
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
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. UST 4.25 05/2034"
            className={inputClass}
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
            onChange={(e) => setCusip(e.target.value.toUpperCase())}
            className={inputClass}
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
          Reason (required — e.g. rebalance, corporate action, advisor-directed)
        </label>
        <textarea
          id="ct-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={2}
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
