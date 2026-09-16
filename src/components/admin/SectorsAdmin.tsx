"use client";

// Sector management + targets form (SPEC 11.3 /admin/sectors).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { easternDateString } from "@/lib/format";
import type { Sector, SectorTarget } from "@/types/domain";

const inputClass =
  "w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

export function SectorsAdmin({
  fund,
  sectors,
  canEditSectors,
}: {
  fund: string;
  sectors: Sector[];
  canEditSectors: boolean;
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/${fund}/sectors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Update failed.");
      return;
    }
    router.refresh();
  }

  async function addSector(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`/api/${fund}/sectors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error ?? "Create failed.");
      return;
    }
    setNewName("");
    router.refresh();
  }

  async function move(index: number, dir: -1 | 1) {
    const other = index + dir;
    if (other < 0 || other >= sectors.length) return;
    await Promise.all([
      patch(sectors[index].id, { sort_order: sectors[other].sort_order }),
      patch(sectors[other].id, { sort_order: sectors[index].sort_order }),
    ]);
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {sectors.map((s, i) => (
          <li
            key={s.id}
            className={`flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 rounded-lg bg-highlight px-3 py-2 text-sm ${
              s.is_active ? "" : "opacity-45"
            }`}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium">{s.name}</span>
              {s.is_strategy_team && (
                <Badge className="shrink-0" tone="info">
                  strategy team
                </Badge>
              )}
              {!s.is_active && (
                <Badge className="shrink-0" tone="neutral">
                  inactive
                </Badge>
              )}
            </div>
            {canEditSectors && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  className="cursor-pointer rounded p-1 text-muted hover:bg-card hover:text-foreground"
                  aria-label={`Move ${s.name} up`}
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  className="cursor-pointer rounded p-1 text-muted hover:bg-card hover:text-foreground"
                  aria-label={`Move ${s.name} down`}
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    patch(s.id, { is_strategy_team: !s.is_strategy_team })
                  }
                  className="cursor-pointer whitespace-nowrap text-xs text-accent hover:underline"
                >
                  {s.is_strategy_team ? "unset strategy" : "set strategy"}
                </button>
                <button
                  type="button"
                  onClick={() => patch(s.id, { is_active: !s.is_active })}
                  className="cursor-pointer whitespace-nowrap text-xs text-muted hover:underline"
                >
                  {s.is_active ? "deactivate" : "activate"}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {canEditSectors && (
        <form onSubmit={addSector} className="flex min-w-0 gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={`${inputClass} min-w-0 flex-1`}
            placeholder="New sector name"
          />
          <Button type="submit" disabled={newName.trim() === ""}>
            Add
          </Button>
        </form>
      )}
      {error && <p className="text-sm text-loss">{error}</p>}
    </div>
  );
}

export function SectorTargetsForm({
  fund,
  sectors,
  latestTargets,
}: {
  fund: string;
  sectors: Sector[];
  /** sector_id -> latest target */
  latestTargets: Record<string, SectorTarget | undefined>;
}) {
  const router = useRouter();
  const active = sectors.filter((s) => s.is_active);
  const [effectiveOn, setEffectiveOn] = useState(easternDateString());
  const [rows, setRows] = useState(
    active.map((s) => ({
      sector_id: s.id,
      name: s.name,
      target: latestTargets[s.id]?.target_weight_pct?.toString() ?? "",
      benchmark: latestTargets[s.id]?.benchmark_weight_pct?.toString() ?? "",
    }))
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const totalTarget = rows.reduce(
    (sum, r) => sum + (Number(r.target) || 0),
    0
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const targets = rows
      .filter((r) => r.target.trim() !== "")
      .map((r) => ({
        sector_id: r.sector_id,
        target_weight_pct: Number(r.target),
        benchmark_weight_pct:
          r.benchmark.trim() === "" ? null : Number(r.benchmark),
      }));
    if (targets.length === 0) {
      setError("Enter at least one target weight.");
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/${fund}/sector-targets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effective_on: effectiveOn, targets }),
    });
    setSaving(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Save failed.");
      return;
    }
    setNotice(`Saved ${data.saved} targets effective ${effectiveOn}.`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-[minmax(0,1fr)_68px_68px] sm:grid-cols-[minmax(0,1fr)_100px_100px] items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-muted">
        <span>Sector</span>
        <span className="text-right">Target %</span>
        <span className="text-right">Benchmark %</span>
      </div>
      {rows.map((r, i) => (
        <div
          key={r.sector_id}
          className="grid grid-cols-[minmax(0,1fr)_68px_68px] sm:grid-cols-[minmax(0,1fr)_100px_100px] items-center gap-2"
        >
          <span className="text-sm">{r.name}</span>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={r.target}
            onChange={(e) =>
              setRows(rows.map((x, j) => (j === i ? { ...x, target: e.target.value } : x)))
            }
            className={`${inputClass} text-right`}
          />
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={r.benchmark}
            onChange={(e) =>
              setRows(rows.map((x, j) => (j === i ? { ...x, benchmark: e.target.value } : x)))
            }
            className={`${inputClass} text-right`}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted">
          Effective on{" "}
          <input
            type="date"
            value={effectiveOn}
            onChange={(e) => setEffectiveOn(e.target.value)}
            className="ml-1 rounded-lg border border-input-border bg-input-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
          />
        </label>
        <span
          className={`text-sm tabular-nums ${
            Math.abs(totalTarget - 100) < 0.5 ? "text-gain" : "text-muted"
          }`}
        >
          Targets sum to {totalTarget.toFixed(1)}%
        </span>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save targets"}
        </Button>
      </div>
      {error && <p className="text-sm text-loss">{error}</p>}
      {notice && <p className="text-sm text-gain">{notice}</p>}
    </form>
  );
}
