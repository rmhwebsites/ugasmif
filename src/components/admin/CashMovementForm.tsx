"use client";

// Cash movement entry (SPEC 11.3): contributions, dividends, coupons, fees.
// Signed amount; the API adjusts funds.cash_balance too.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { easternDateString } from "@/lib/format";
import type { Holding } from "@/types/domain";

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
const labelClass = "mb-1 block text-xs font-medium text-muted";

export function CashMovementForm({
  fund,
  holdings,
}: {
  fund: string;
  holdings: Pick<Holding, "id" | "name">[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    kind: "dividend",
    amount: "",
    holding_id: "",
    occurred_on: easternDateString(),
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    const res = await fetch(`/api/${fund}/cash-movements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: form.kind,
        amount: Number(form.amount),
        holding_id: form.holding_id || null,
        occurred_on: form.occurred_on,
        notes: form.notes.trim() || null,
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Save failed.");
      return;
    }
    setNotice(`Recorded. New cash balance: $${Number(data.cash_balance).toLocaleString()}`);
    setForm({ ...form, amount: "", notes: "" });
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-5">
      <div>
        <label className={labelClass}>Kind</label>
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
          className={inputClass}
        >
          {["contribution", "withdrawal", "dividend", "coupon", "interest", "fee", "adjustment"].map(
            (k) => (
              <option key={k} value={k}>
                {k}
              </option>
            )
          )}
        </select>
      </div>
      <div>
        <label className={labelClass}>Amount (signed $)</label>
        <input
          type="number"
          step="0.01"
          required
          value={form.amount}
          onChange={(e) => setForm({ ...form, amount: e.target.value })}
          className={inputClass}
          placeholder="-1250.00 for outflow"
        />
      </div>
      <div>
        <label className={labelClass}>Holding (optional)</label>
        <select
          value={form.holding_id}
          onChange={(e) => setForm({ ...form, holding_id: e.target.value })}
          className={inputClass}
        >
          <option value="">—</option>
          {holdings.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Date</label>
        <input
          type="date"
          required
          value={form.occurred_on}
          onChange={(e) => setForm({ ...form, occurred_on: e.target.value })}
          className={inputClass}
        />
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "…" : "Record"}
        </Button>
      </div>
      <div className="sm:col-span-5">
        <input
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className={inputClass}
          placeholder="Notes (optional)"
        />
      </div>
      {error && <p className="text-sm text-loss sm:col-span-5">{error}</p>}
      {notice && <p className="text-sm text-gain sm:col-span-5">{notice}</p>}
    </form>
  );
}
