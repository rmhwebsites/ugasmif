// The pass rule a vote is judged under (SPEC Section 12).
//
// Both numbers are frozen onto the pitch when voting opens, the same moment
// eligible_voters freezes, so changing fund settings mid-vote or years later
// never rewrites how a result reads. `threshold_pct` is the marker that a rule
// was captured: `quorum_pct` is legitimately null when the fund has no quorum,
// so it cannot tell "no quorum" from "nothing frozen" on its own.
//
// Pitches opened before migration 0004 carry neither and fall back to the
// fund's current settings, which is the best guess available. close_pitch_vote
// makes the same choice in SQL — keep the two in step.

import type { Fund, Pitch } from "@/types/domain";

export interface VoteRule {
  thresholdPct: number;
  /** null when no quorum applies. */
  quorumPct: number | null;
}

export function voteRule(
  pitch: Pick<Pitch, "threshold_pct" | "quorum_pct">,
  fund: Pick<Fund, "vote_pass_threshold_pct" | "vote_quorum_pct">
): VoteRule {
  const frozen = pitch.threshold_pct !== null;
  const threshold = frozen ? pitch.threshold_pct : fund.vote_pass_threshold_pct;
  const quorum = frozen ? pitch.quorum_pct : fund.vote_quorum_pct;
  return {
    thresholdPct: Number(threshold),
    quorumPct: quorum === null ? null : Number(quorum),
  };
}
