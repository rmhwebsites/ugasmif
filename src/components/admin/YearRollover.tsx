"use client";

// Academic year rollover with a typed confirmation (SPEC 17.2).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function YearRollover({
  fund,
  currentLabel,
  nextLabel,
}: {
  fund: string;
  currentLabel: string;
  nextLabel: string;
}) {
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    const res = await fetch(`/api/${fund}/year`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm_label: confirm.trim() }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error ?? "Rollover failed.");
      return;
    }
    setNotice(
      `${nextLabel} is now the current year. ${data.memberships_archived} memberships became alumni. Import the new roster next.`
    );
    setConfirm("");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-lg bg-highlight p-4 text-sm">
        <p className="font-medium">Starting {nextLabel} will:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
          <li>
            Make every active {currentLabel} membership in <em>both</em> funds
            an alumni membership (read-only access, nothing deleted).
          </li>
          <li>Create {nextLabel} and make it the current academic year.</li>
          <li>
            Leave holdings, trades, pitches, and votes untouched — last
            year&apos;s history stays intact.
          </li>
          <li>
            Leave the roster empty until you import it, so do this right before
            importing the new roster.
          </li>
        </ul>
      </div>

      <label className="block text-sm">
        <span className="text-muted">
          Type <strong className="text-foreground">{nextLabel}</strong> to
          confirm
        </span>
        <input
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="mt-1 w-full max-w-xs rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent"
          placeholder={nextLabel}
        />
      </label>

      {error && <p className="text-sm text-loss">{error}</p>}
      {notice && <p className="text-sm text-gain">{notice}</p>}

      <Button
        type="submit"
        variant="danger"
        disabled={busy || confirm.trim() !== nextLabel}
      >
        {busy ? "Rolling over…" : `Start ${nextLabel}`}
      </Button>
    </form>
  );
}
