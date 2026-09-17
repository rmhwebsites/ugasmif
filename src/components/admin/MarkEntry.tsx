"use client";

// Per-bond mark entry + the bulk CSV upload + cash movements + snapshot
// import (SPEC 11.3 /admin/holdings tools).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import type { Holding } from "@/types/domain";

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
const labelClass = "mb-1 block text-xs font-medium text-muted";

export function MarkEntry({
  fund,
  holding,
  onDone,
}: {
  fund: string;
  holding: Holding;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    clean_price: "",
    ytm: "",
    duration: holding.duration?.toString() ?? "",
    source: "bloomberg",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/${fund}/marks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        holding_id: holding.id,
        clean_price: Number(form.clean_price),
        ytm: form.ytm.trim() === "" ? null : Number(form.ytm),
        duration: form.duration.trim() === "" ? null : Number(form.duration),
        source: form.source,
        notes: form.notes.trim() || null,
      }),
    });
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
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-5">
      <div>
        <label className={labelClass}>Clean price</label>
        <input
          type="number"
          step="0.001"
          min="1"
          max="300"
          required
          value={form.clean_price}
          onChange={(e) => setForm({ ...form, clean_price: e.target.value })}
          className={inputClass}
          placeholder="99.125"
        />
      </div>
      <div>
        <label className={labelClass}>YTM (%)</label>
        <input
          type="number"
          step="0.001"
          value={form.ytm}
          onChange={(e) => setForm({ ...form, ytm: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Duration</label>
        <input
          type="number"
          step="0.01"
          min="0"
          value={form.duration}
          onChange={(e) => setForm({ ...form, duration: e.target.value })}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Source</label>
        <select
          value={form.source}
          onChange={(e) => setForm({ ...form, source: e.target.value })}
          className={inputClass}
        >
          <option value="bloomberg">Bloomberg</option>
          <option value="broker">Broker</option>
          <option value="finra_trace">FINRA TRACE</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="flex items-end gap-2">
        <Button type="submit" disabled={saving} className="w-full">
          {saving ? "…" : "Save mark"}
        </Button>
      </div>
      {error && <p className="text-sm text-loss sm:col-span-5">{error}</p>}
    </form>
  );
}

export function CsvTool({
  title,
  hint,
  placeholder,
  endpoint,
  successVerb,
  countKey,
  noun,
}: {
  title: string;
  hint: string;
  placeholder: string;
  endpoint: string;
  /** e.g. "Inserted" — kept as plain strings because a server component
   *  renders this and React cannot serialize a function prop. */
  successVerb: string;
  /** field on the JSON response holding the row count, e.g. "inserted" */
  countKey: string;
  /** e.g. "marks" */
  noun: string;
}) {
  const router = useRouter();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ row: number; message: string }[]>([]);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    setNotes([]);
    setErrors([]);
    setBusy(true);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setResult(data?.error ?? "Upload failed.");
      return;
    }
    const count = Number(data?.[countKey] ?? 0);
    setResult(`${successVerb} ${count} ${count === 1 ? noun.replace(/s$/, "") : noun}.`);
    // Routes explain the things a bare count cannot: rows skipped because
    // they already existed, a feed that was unreachable. "Imported 0" with no
    // reason is the confusing case this avoids.
    setNotes(
      (["note", "skippedNote", "benchmarkNote"] as const)
        .map((k) => data?.[k])
        .filter((v): v is string => typeof v === "string" && v !== "")
    );
    setErrors(data.errors ?? []);
    setCsv("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={5}
        className={`${inputClass} font-mono text-xs`}
        placeholder={placeholder}
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={busy || csv.trim() === ""}>
          {busy ? "Uploading…" : "Upload"}
        </Button>
        {result && <span className="text-sm text-muted">{result}</span>}
      </div>
      {notes.map((note) => (
        <p key={note} className="text-xs text-muted">
          {note}
        </p>
      ))}
      {errors.length > 0 && (
        <ul className="space-y-0.5 text-xs text-loss">
          {errors.slice(0, 10).map((e) => (
            <li key={`${e.row}-${e.message}`}>
              Row {e.row}: {e.message}
            </li>
          ))}
          {errors.length > 10 && <li>…and {errors.length - 10} more</li>}
        </ul>
      )}
    </form>
  );
}
