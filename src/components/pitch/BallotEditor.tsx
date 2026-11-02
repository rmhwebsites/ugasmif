"use client";

// The officer's form for what a pitch is voted on: the pitch as written, the
// alternative allocations the class proposed, and No. Opens from the Vote
// card; works before voting opens and while it is open.
//
// Saving the whole list goes to PUT /api/[fund]/pitches/[id]/ballot. A
// removed option, or one whose amount changed, loses the ballots cast for it,
// and those members get the ballot again; the form says how many before you
// save.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Plus, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  MAX_BALLOT_OPTIONS,
  MAX_LABEL_LENGTH,
  defaultLabel,
  formatAllocation,
  labelMismatch,
  planBallotEdit,
  type DraftOption,
} from "@/lib/ballot";
import type { VoteOptionKind } from "@/types/domain";

export interface EditableOption {
  /** Missing for the defaults of a ballot nobody has saved yet. */
  id?: string;
  kind: VoteOptionKind;
  label: string;
  /** As stored: null means "the amount pitched". */
  amount: number | null;
  sort_order: number;
  /** Ballots cast for it so far (0 before voting opens). */
  ballots: number;
}

interface Row {
  key: string;
  id?: string;
  kind: VoteOptionKind;
  label: string;
  amountText: string;
}

function toRow(o: EditableOption, i: number): Row {
  return {
    key: o.id ?? `default-${i}`,
    id: o.id,
    kind: o.kind,
    label: o.label,
    amountText:
      o.amount === null
        ? ""
        : Number(o.amount).toLocaleString("en-US", { maximumFractionDigits: 2 }),
  };
}

/** "$60,000", "60000", "60,000.50" → number; blank → null; junk → NaN. */
function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return null;
  return /^\d+(\.\d{1,2})?$/.test(t) ? Number(t) : Number.NaN;
}

let nextKey = 0;

export function BallotEditor({
  fund,
  pitchId,
  options,
  proposedAmount,
  voting,
  onClose,
}: {
  fund: string;
  pitchId: string;
  /** The ballot as it stands; the defaults when none has been set up yet. */
  options: EditableOption[];
  proposedAmount: number | null;
  /** Voting is open, so edits can clear ballots. */
  voting: boolean;
  onClose: (saved?: string) => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => options.map(toRow));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approves = rows.filter((r) => r.kind === "approve");
  const reject = rows.find((r) => r.kind === "reject");

  const draft: DraftOption[] = useMemo(
    () =>
      [...rows.filter((r) => r.kind === "approve"), ...rows.filter((r) => r.kind === "reject")].map(
        (r) => ({
          ...(r.id ? { id: r.id } : {}),
          kind: r.kind,
          label: r.label,
          amount: r.kind === "reject" ? null : parseAmount(r.amountText),
        })
      ),
    [rows]
  );
  const badAmount = draft.some((d) => d.amount !== null && !Number.isFinite(d.amount));
  const preview = useMemo(
    () =>
      badAmount
        ? null
        : planBallotEdit(
            options.filter((o): o is EditableOption & { id: string } => o.id !== undefined),
            draft
          ),
    [badAmount, options, draft]
  );
  const cleared = preview && "plan" in preview ? preview.plan.cleared : 0;
  const unchanged =
    preview !== null &&
    "plan" in preview &&
    preview.plan.inserts.length + preview.plan.updates.length + preview.plan.deletes.length === 0;

  function update(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setError(null);
  }

  // A name the form made up ("Yes, at $60,000") follows its amount, so a
  // new amount can't leave the old figure on the ballot. A name an officer
  // wrote is theirs and stays.
  function setAmount(r: Row, amountText: string) {
    const before = parseAmount(r.amountText);
    const auto =
      r.label.trim() === "" ||
      r.label === defaultLabel("approve", before !== null && Number.isFinite(before) ? before : null);
    update(r.key, auto ? { amountText, label: "" } : { amountText });
  }

  function addAlternative() {
    nextKey += 1;
    setRows((rs) => [
      ...rs.filter((r) => r.kind === "approve"),
      { key: `new-${nextKey}`, kind: "approve", label: "", amountText: "" },
      ...rs.filter((r) => r.kind === "reject"),
    ]);
  }

  async function save() {
    if (badAmount) {
      setError("Amounts are dollars, like 60000 or $60,000.");
      return;
    }
    if (preview && "error" in preview) {
      setError(preview.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/${fund}/pitches/${pitchId}/ballot`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: draft }),
      });
      const json: { error?: string; cleared?: number } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "The ballot could not be saved. Try again.");
        setBusy(false);
        return;
      }
      const n = json.cleared ?? 0;
      router.refresh();
      onClose(
        n > 0
          ? `Ballot saved. ${n} ${n === 1 ? "member's ballot was" : "members' ballots were"} cleared; they'll be asked to vote again.`
          : "Ballot saved."
      );
    } catch {
      setError("Network error: the ballot was not saved. Try again.");
      setBusy(false);
    }
  }

  const ballotsFor = (r: Row) =>
    r.id === undefined ? 0 : options.find((o) => o.id === r.id)?.ballots ?? 0;
  const pitched = proposedAmount === null ? null : formatAllocation(proposedAmount);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Ballot options</h3>
        <p className="mt-0.5 text-xs text-muted">
          Add the allocations the class is choosing between. If the pitch
          passes, the yes option with the most votes goes on the trade ticket,
          and a tie goes to the one listed first. Members can always abstain.
        </p>
      </div>

      <ul className="space-y-2">
        {approves.map((r, i) => {
          const amount = parseAmount(r.amountText);
          const n = ballotsFor(r);
          return (
            <li key={r.key} className="rounded-lg border border-card-border p-2.5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-gain" aria-hidden />
                <input
                  value={r.label}
                  onChange={(e) => update(r.key, { label: e.target.value })}
                  maxLength={MAX_LABEL_LENGTH}
                  placeholder={defaultLabel("approve", amount !== null && Number.isFinite(amount) ? amount : null)}
                  aria-label={`Name of yes option ${i + 1}`}
                  className="min-w-0 flex-1 rounded-md border border-input-border bg-input-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                  disabled={approves.length <= 1}
                  title={approves.length <= 1 ? "A ballot needs at least one yes" : "Remove this option"}
                  aria-label={`Remove ${r.label || `yes option ${i + 1}`}`}
                  className="shrink-0 rounded-md p-1.5 text-muted transition-colors hover:bg-highlight hover:text-loss disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  Amount
                  <input
                    value={r.amountText}
                    onChange={(e) => setAmount(r, e.target.value)}
                    inputMode="decimal"
                    placeholder={pitched ?? "$"}
                    className={`w-32 rounded-md border bg-input-bg px-2.5 py-1.5 text-sm tabular-nums text-foreground outline-none focus:border-accent ${
                      amount !== null && !Number.isFinite(amount) ? "border-loss" : "border-input-border"
                    }`}
                  />
                </label>
                {r.amountText.trim() === "" && (
                  <span className="text-xs text-muted">
                    {pitched ? `blank keeps the pitched ${pitched}` : "blank means no set amount"}
                  </span>
                )}
                {n > 0 && (
                  <span className="ml-auto text-xs text-muted tabular-nums">
                    {n} {n === 1 ? "vote" : "votes"}
                  </span>
                )}
              </div>
              {(() => {
                const warning = labelMismatch(
                  r.label,
                  amount !== null && Number.isFinite(amount) ? amount : null,
                  proposedAmount
                );
                return warning ? (
                  <p className="mt-1.5 pl-6 text-xs text-loss">{warning}</p>
                ) : null;
              })()}
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={addAlternative}
        disabled={rows.length >= MAX_BALLOT_OPTIONS}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-accent-text transition-colors hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus className="h-4 w-4" />
        Add an alternative allocation
      </button>

      {reject && (
        <div className="flex items-center gap-2 rounded-lg border border-card-border p-2.5">
          <XCircle className="h-4 w-4 shrink-0 text-loss" aria-hidden />
          <input
            value={reject.label}
            onChange={(e) => update(reject.key, { label: e.target.value })}
            maxLength={MAX_LABEL_LENGTH}
            placeholder="No"
            aria-label="Name of the no option"
            className="min-w-0 flex-1 rounded-md border border-input-border bg-input-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
          {ballotsFor(reject) > 0 && (
            <span className="shrink-0 text-xs text-muted tabular-nums">
              {ballotsFor(reject)} {ballotsFor(reject) === 1 ? "vote" : "votes"}
            </span>
          )}
        </div>
      )}

      {voting && cleared > 0 && (
        <p className="rounded-lg bg-loss/10 px-3 py-2 text-sm text-loss">
          Saving clears {cleared} {cleared === 1 ? "ballot" : "ballots"} cast for
          an option you removed or gave a new amount. Those members will be
          asked to vote again.
        </p>
      )}
      {error && <p className="text-sm text-loss">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy || unchanged}>
          {busy ? "Saving…" : "Save ballot"}
        </Button>
        <Button variant="secondary" onClick={() => onClose()} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
