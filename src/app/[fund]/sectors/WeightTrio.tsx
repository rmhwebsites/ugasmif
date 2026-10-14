// Weight / Target / Benchmark: a sector's share of the fund next to what it
// should be. The Sectors cards and the sector page both show it. A missing
// target reads "Not set" rather than a bare dash, and TargetsNote says who
// sets targets and how everyone else proposes a change.

import type { ReactNode } from "react";
import Link from "next/link";
import { formatPercent } from "@/lib/format";

function Figure({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      {value === null ? (
        <p className="text-muted">Not set</p>
      ) : (
        <p className="font-semibold">{formatPercent(value)}</p>
      )}
    </div>
  );
}

export function WeightTrio({
  weight,
  target,
  benchmark,
  showTargets = true,
  className = "",
}: {
  weight: number;
  target: number | null;
  benchmark: number | null;
  /** The strategy team has no target of its own, so it shows weight only. */
  showTargets?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`grid grid-cols-3 gap-2 text-sm tabular-nums ${className}`}
    >
      <Figure label="Weight" value={weight} />
      {showTargets && (
        <>
          <Figure label="Target" value={target} />
          <Figure label="Benchmark" value={benchmark} />
        </>
      )}
    </div>
  );
}

const LINK = "font-medium text-accent-text hover:underline";

/**
 * Who sets sector targets, in words: officers, plus the leader of the fund's
 * strategy team (Equity Strategies / Macro) when it has one. Mirrors
 * can(ctx, "set_sector_targets").
 */
export function whoSetsTargets(strategyTeamName: string | null): string {
  return strategyTeamName
    ? `Officers and the ${strategyTeamName} leader`
    : "Officers";
}

/**
 * One line under the figures. People who set targets get the way to Manage
 * sectors when one is missing; everyone else learns who sets them and, if
 * they can pitch, that a rebalance pitch is how to ask for a change.
 */
export function TargetsNote({
  fund,
  canSetTargets,
  canDraft,
  strategyTeamName,
  missing,
  isStrategyTeam = false,
  className = "",
}: {
  fund: string;
  canSetTargets: boolean;
  canDraft: boolean;
  strategyTeamName: string | null;
  /** Some target shown alongside this note is not set. */
  missing: boolean;
  /** The note sits on the strategy team's own page. */
  isStrategyTeam?: boolean;
  className?: string;
}) {
  const manage = (
    <Link href={`/${fund}/admin/sectors#targets`} className={LINK}>
      Manage sectors
    </Link>
  );
  const rebalance = (
    <Link href={`/${fund}/pitches/new?action=rebalance`} className={LINK}>
      start a rebalance pitch
    </Link>
  );

  let body: ReactNode = null;
  if (isStrategyTeam) {
    body = (
      <>
        This team sets the target and benchmark weights for the fund&apos;s
        other sectors.
        {canSetTargets && <> Set them on {manage}.</>}
      </>
    );
  } else if (canSetTargets) {
    if (missing) {
      body = (
        <>
          &ldquo;Not set&rdquo; means nobody has entered a target yet. Set
          targets on {manage}.
        </>
      );
    }
  } else {
    body = (
      <>
        {whoSetsTargets(strategyTeamName)} set target and benchmark weights.
        {canDraft && <> To propose a change, {rebalance}.</>}
      </>
    );
  }

  if (!body) return null;
  return <p className={`text-xs text-muted ${className}`}>{body}</p>;
}
