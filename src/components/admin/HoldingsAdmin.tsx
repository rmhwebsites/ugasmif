"use client";

// Interactive holdings admin table: expand a row to edit or enter a mark,
// deactivate/reactivate with confirmation (SPEC 11.3).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { HoldingForm } from "@/components/admin/HoldingForm";
import { MarkEntry } from "@/components/admin/MarkEntry";
import { formatBondPrice, formatDate, formatNumber } from "@/lib/format";
import type { BondMark, Holding, Sector } from "@/types/domain";

export function HoldingsAdmin({
  fund,
  holdings,
  sectors,
  latestMarks,
  staleDays,
}: {
  fund: string;
  holdings: Holding[];
  sectors: Pick<Sector, "id" | "name">[];
  /** holding_id -> latest mark */
  latestMarks: Record<string, BondMark | undefined>;
  staleDays: number;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mode, setMode] = useState<"edit" | "mark">("edit");
  const sectorName = (id: string | null) =>
    sectors.find((s) => s.id === id)?.name ?? "—";

  async function toggleActive(h: Holding) {
    const verb = h.is_active ? "Deactivate" : "Reactivate";
    if (!window.confirm(`${verb} ${h.name}?`)) return;
    await fetch(`/api/${fund}/holdings/${h.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !h.is_active }),
    });
    router.refresh();
  }

  const staleCutoff = Date.now() - staleDays * 24 * 60 * 60 * 1000;

  return (
    <div className="glass-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 640 }}>
          <thead>
            <tr className="border-b border-card-border text-left text-[10px] uppercase tracking-wider text-muted">
              <th className="sticky left-0 z-10 bg-sticky px-4 py-2.5 font-medium backdrop-blur-xl">
                Holding
              </th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Sector</th>
              <th className="px-3 py-2.5 text-right font-medium">Qty / Face</th>
              <th className="px-3 py-2.5 font-medium">Pricing</th>
              <th className="px-3 py-2.5 font-medium">Latest mark</th>
              <th className="px-3 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((h) => {
              const mark = latestMarks[h.id];
              const markStale =
                h.pricing_method === "manual" &&
                (!mark || new Date(mark.marked_at).getTime() < staleCutoff);
              return (
                <HoldingRows
                  key={h.id}
                  h={h}
                  mark={mark}
                  markStale={markStale}
                  fund={fund}
                  sectors={sectors}
                  sectorName={sectorName}
                  expanded={expanded === h.id}
                  mode={mode}
                  onExpand={(m) => {
                    setMode(m);
                    setExpanded(expanded === h.id && mode === m ? null : h.id);
                  }}
                  onToggleActive={() => toggleActive(h)}
                  onDone={() => setExpanded(null)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HoldingRows({
  h,
  mark,
  markStale,
  fund,
  sectors,
  sectorName,
  expanded,
  mode,
  onExpand,
  onToggleActive,
  onDone,
}: {
  h: Holding;
  mark: BondMark | undefined;
  markStale: boolean;
  fund: string;
  sectors: Pick<Sector, "id" | "name">[];
  sectorName: (id: string | null) => string;
  expanded: boolean;
  mode: "edit" | "mark";
  onExpand: (mode: "edit" | "mark") => void;
  onToggleActive: () => void;
  onDone: () => void;
}) {
  const canMark =
    h.pricing_method === "manual" || h.pricing_method === "treasury_curve";
  return (
    <>
      <tr
        className={`border-b border-card-border/50 ${
          h.is_active ? "" : "opacity-45"
        }`}
      >
        <td className="sticky left-0 z-10 bg-sticky px-4 py-2.5 backdrop-blur-xl">
          <p className="font-medium">
            {h.symbol ? `${h.symbol} · ` : ""}
            {h.name}
          </p>
          {h.cusip && <p className="text-xs text-muted">CUSIP {h.cusip}</p>}
        </td>
        <td className="px-3 py-2.5 text-muted">
          {h.instrument_type.replace("_", " ")}
        </td>
        <td className="px-3 py-2.5 text-muted">{sectorName(h.sector_id)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">
          {formatNumber(Number(h.quantity), 0)}
        </td>
        <td className="px-3 py-2.5">
          <Badge
            tone={
              h.pricing_method === "live"
                ? "gain"
                : h.pricing_method === "treasury_curve"
                ? "info"
                : "neutral"
            }
          >
            {h.pricing_method.replace("_", " ")}
          </Badge>
        </td>
        <td className="px-3 py-2.5">
          {h.pricing_method === "manual" ? (
            mark ? (
              <span className={markStale ? "text-loss" : ""}>
                {formatBondPrice(Number(mark.clean_price))} ·{" "}
                {formatDate(mark.marked_at)}
                {markStale && " (stale)"}
              </span>
            ) : (
              <span className="text-loss">never marked</span>
            )
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="px-3 py-2.5 text-right whitespace-nowrap">
          {canMark && h.is_active && (
            <button
              type="button"
              onClick={() => onExpand("mark")}
              className="mr-2 cursor-pointer text-xs text-accent hover:underline"
            >
              Enter mark
            </button>
          )}
          <button
            type="button"
            onClick={() => onExpand("edit")}
            className="mr-2 cursor-pointer text-xs text-accent hover:underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onToggleActive}
            className="cursor-pointer text-xs text-muted hover:text-loss hover:underline"
          >
            {h.is_active ? "Deactivate" : "Reactivate"}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-card-border/50 bg-highlight/50">
          <td colSpan={7} className="px-4 py-4">
            {mode === "edit" ? (
              <HoldingForm
                fund={fund}
                sectors={sectors}
                holding={h}
                onDone={onDone}
              />
            ) : (
              <MarkEntry fund={fund} holding={h} onDone={onDone} />
            )}
          </td>
        </tr>
      )}
    </>
  );
}
