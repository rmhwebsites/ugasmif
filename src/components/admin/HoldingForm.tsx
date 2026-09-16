"use client";

// Add/edit holding form (SPEC 11.3 /admin/holdings). Bond fields appear per
// instrument type; a small GICS map pre-selects a sector for common tickers.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { Holding, InstrumentType, Sector } from "@/types/domain";

const BOND_TYPES: InstrumentType[] = [
  "treasury",
  "corporate",
  "agency_mbs",
  "municipal",
];

// Suggestion only — the officer can always override (SPEC Section 3).
const GICS_SUGGESTIONS: Record<string, string> = {
  AAPL: "Technology", MSFT: "Technology", NVDA: "Technology", AVGO: "Technology",
  ANET: "Technology", NOW: "Technology", CRM: "Technology", FTNT: "Technology",
  JPM: "Financial Institutions Group", GS: "Financial Institutions Group",
  MCO: "Financial Institutions Group", AON: "Financial Institutions Group",
  UNH: "Healthcare", HCA: "Healthcare", ZTS: "Healthcare", AZN: "Healthcare",
  LH: "Healthcare", STE: "Healthcare", META: "Communication Services",
  GOOGL: "Communication Services", CMCSA: "Communication Services",
  GD: "Industrials", RTX: "Industrials", DE: "Industrials", WM: "Industrials",
  MCD: "Consumer Discretionary", SBUX: "Consumer Discretionary",
  LEN: "Consumer Discretionary", WMT: "Staples", MDLZ: "Staples",
  DG: "Staples", NEE: "Energy & Utilities", XOM: "Energy & Utilities",
  MLM: "REITs & Materials", OHI: "REITs & Materials", WPC: "REITs & Materials",
};

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
const labelClass = "mb-1 block text-xs font-medium text-muted";

export function HoldingForm({
  fund,
  sectors,
  holding,
  onDone,
}: {
  fund: string;
  sectors: Pick<Sector, "id" | "name">[];
  /** present = edit mode */
  holding?: Holding;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    instrument_type: (holding?.instrument_type ?? "equity") as InstrumentType,
    symbol: holding?.symbol ?? "",
    cusip: holding?.cusip ?? "",
    name: holding?.name ?? "",
    issuer: holding?.issuer ?? "",
    sector_id: holding?.sector_id ?? "",
    quantity: holding?.quantity?.toString() ?? "",
    avg_cost: holding?.avg_cost?.toString() ?? "",
    coupon_rate: holding?.coupon_rate?.toString() ?? "",
    maturity_date: holding?.maturity_date ?? "",
    payment_frequency: holding?.payment_frequency?.toString() ?? "2",
    day_count: holding?.day_count ?? "",
    rating: holding?.rating ?? "",
    duration: holding?.duration?.toString() ?? "",
    ytm: holding?.ytm?.toString() ?? "",
    pricing_method: holding?.pricing_method ?? "live",
    benchmark_tenor: holding?.benchmark_tenor?.toString() ?? "",
    opened_on: holding?.opened_on ?? "",
    notes: holding?.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isBond = BOND_TYPES.includes(form.instrument_type);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "symbol") {
        const suggested = GICS_SUGGESTIONS[value.toUpperCase()];
        if (suggested && !f.sector_id) {
          const match = sectors.find((s) => s.name === suggested);
          if (match) next.sector_id = match.id;
        }
      }
      if (field === "instrument_type") {
        next.pricing_method =
          value === "treasury"
            ? "treasury_curve"
            : ["equity", "etf", "money_market"].includes(value)
            ? "live"
            : "manual";
        if (BOND_TYPES.includes(value as InstrumentType) && !f.day_count) {
          next.day_count = value === "treasury" ? "ACT/ACT" : "30/360";
        }
      }
      return next;
    });
  }

  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const body = {
      instrument_type: form.instrument_type,
      symbol: form.symbol.trim() || null,
      cusip: form.cusip.trim() || null,
      name: form.name.trim(),
      issuer: form.issuer.trim() || null,
      sector_id: form.sector_id || null,
      quantity: Number(form.quantity || 0),
      avg_cost: Number(form.avg_cost || 0),
      coupon_rate: isBond ? num(form.coupon_rate) : null,
      maturity_date: isBond ? form.maturity_date || null : null,
      payment_frequency: isBond ? num(form.payment_frequency) : null,
      day_count: isBond ? form.day_count || null : null,
      rating: isBond ? form.rating.trim() || null : null,
      duration: isBond ? num(form.duration) : null,
      ytm: isBond ? num(form.ytm) : null,
      pricing_method: form.pricing_method,
      benchmark_tenor: isBond ? num(form.benchmark_tenor) : null,
      opened_on: form.opened_on || null,
      notes: form.notes.trim() || null,
    };
    const res = await fetch(
      holding
        ? `/api/${fund}/holdings/${holding.id}`
        : `/api/${fund}/holdings`,
      {
        method: holding ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Save failed.");
      return;
    }
    router.refresh();
    onDone?.();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass}>Instrument type</label>
        <select
          value={form.instrument_type}
          onChange={(e) => set("instrument_type", e.target.value)}
          className={inputClass}
          disabled={!!holding}
        >
          {["equity", "etf", "treasury", "corporate", "agency_mbs", "municipal", "money_market"].map(
            (t) => (
              <option key={t} value={t}>
                {t.replace("_", " ")}
              </option>
            )
          )}
        </select>
      </div>
      <div>
        <label className={labelClass}>Sector</label>
        <select
          value={form.sector_id}
          onChange={(e) => set("sector_id", e.target.value)}
          className={inputClass}
        >
          <option value="">— none —</option>
          {sectors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className={labelClass}>
          {isBond ? "Symbol (optional)" : "Yahoo symbol"}
        </label>
        <input
          value={form.symbol}
          onChange={(e) => set("symbol", e.target.value.toUpperCase())}
          className={inputClass}
          placeholder={isBond ? "" : "AAPL"}
          required={["equity", "etf"].includes(form.instrument_type)}
        />
      </div>
      <div>
        <label className={labelClass}>Name</label>
        <input
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label className={labelClass}>
          {isBond ? "Face value ($)" : "Shares"}
        </label>
        <input
          type="number"
          step="any"
          min="0"
          value={form.quantity}
          onChange={(e) => set("quantity", e.target.value)}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label className={labelClass}>
          {isBond ? "Avg cost (per 100 face)" : "Avg cost (per share)"}
        </label>
        <input
          type="number"
          step="any"
          min="0"
          value={form.avg_cost}
          onChange={(e) => set("avg_cost", e.target.value)}
          className={inputClass}
          required
        />
      </div>

      <div>
        <label className={labelClass}>Pricing method</label>
        <select
          value={form.pricing_method}
          onChange={(e) => set("pricing_method", e.target.value)}
          className={inputClass}
        >
          <option value="live">live (Yahoo)</option>
          <option value="treasury_curve">treasury curve</option>
          <option value="manual">manual marks</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Opened on</label>
        <input
          type="date"
          value={form.opened_on}
          onChange={(e) => set("opened_on", e.target.value)}
          className={inputClass}
        />
      </div>

      {isBond && (
        <>
          <div>
            <label className={labelClass}>CUSIP</label>
            <input
              value={form.cusip}
              onChange={(e) => set("cusip", e.target.value.toUpperCase())}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Issuer</label>
            <input
              value={form.issuer}
              onChange={(e) => set("issuer", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Coupon (%)</label>
            <input
              type="number"
              step="0.001"
              min="0"
              value={form.coupon_rate}
              onChange={(e) => set("coupon_rate", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Maturity</label>
            <input
              type="date"
              value={form.maturity_date}
              onChange={(e) => set("maturity_date", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Coupons / year</label>
            <select
              value={form.payment_frequency}
              onChange={(e) => set("payment_frequency", e.target.value)}
              className={inputClass}
            >
              {[1, 2, 4, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Day count</label>
            <select
              value={form.day_count}
              onChange={(e) => set("day_count", e.target.value)}
              className={inputClass}
            >
              <option value="">—</option>
              <option value="30/360">30/360</option>
              <option value="ACT/ACT">ACT/ACT</option>
              <option value="ACT/360">ACT/360</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>Rating</label>
            <input
              value={form.rating}
              onChange={(e) => set("rating", e.target.value.toUpperCase())}
              className={inputClass}
              placeholder="AA+"
            />
          </div>
          <div>
            <label className={labelClass}>Modified duration</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={form.duration}
              onChange={(e) => set("duration", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>YTM (%)</label>
            <input
              type="number"
              step="0.001"
              value={form.ytm}
              onChange={(e) => set("ytm", e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Benchmark tenor (years)</label>
            <input
              type="number"
              step="0.5"
              min="0"
              value={form.benchmark_tenor}
              onChange={(e) => set("benchmark_tenor", e.target.value)}
              className={inputClass}
              placeholder="10"
            />
          </div>
        </>
      )}

      <div className="sm:col-span-2">
        <label className={labelClass}>Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          className={inputClass}
          rows={2}
        />
      </div>

      {error && (
        <p className="text-sm text-loss sm:col-span-2">{error}</p>
      )}

      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : holding ? "Save changes" : "Add holding"}
        </Button>
        {onDone && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
