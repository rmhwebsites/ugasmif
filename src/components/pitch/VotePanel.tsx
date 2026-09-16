"use client";

// Cast / change a vote while the window is open (SPEC Section 12). What the
// viewer may see is decided server-side and passed down: members get their
// own ballot state plus how many ballots are in, never the split;
// officers/advisor (canViewIndividual) also get the live split and the voter
// roll via TallyCard. After close everyone sees the yes/no counts, the
// percentage, and the pass/fail badge — names stay officer-only.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, Users, Vote, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TallyCard, type TallyVoter } from "@/components/pitch/TallyCard";
import { formatDateTime } from "@/lib/format";
import type { PitchStatus, VoteChoice } from "@/types/domain";

export function VotePanel({
  fund,
  pitchId,
  status,
  voteClosesAt,
  votesYes,
  votesNo,
  resultPct,
  eligibleVoters,
  thresholdPct,
  quorumPct,
  canVote,
  voteBlockedReason,
  canViewIndividual,
  myVote,
  ballotsCast = null,
  liveYes = null,
  liveNo = null,
  voters = null,
}: {
  fund: string;
  pitchId: string;
  status: PitchStatus;
  voteClosesAt: string | null;
  /** Stored tallies from the pitch row (set at close). */
  votesYes: number;
  votesNo: number;
  resultPct: number | null;
  eligibleVoters: number | null;
  /**
   * The rule the vote was judged under — frozen on the pitch at close, the
   * fund's current setting while the vote is still open.
   */
  thresholdPct: number;
  quorumPct: number | null;
  canVote: boolean;
  voteBlockedReason?: string | null;
  canViewIndividual: boolean;
  myVote: { choice: VoteChoice; comment: string | null } | null;
  /** Total ballots cast so far — the count members may see, never the split. */
  ballotsCast?: number | null;
  /** Live counts — only passed when the viewer holds view_individual_votes. */
  liveYes?: number | null;
  liveNo?: number | null;
  voters?: TallyVoter[] | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<VoteChoice | null>(myVote?.choice ?? null);
  const [comment, setComment] = useState(myVote?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const open = status === "voting";
  const closed = status === "passed" || status === "failed" || status === "executed";

  async function castVote() {
    if (!choice) {
      setError("Pick Yes or No first.");
      return;
    }
    setBusy(true);
    setError(null);
    setJustSaved(false);
    try {
      const res = await fetch(`/api/${fund}/pitches/${pitchId}/vote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          choice,
          comment: comment.trim() === "" ? undefined : comment.trim(),
        }),
      });
      const json: { error?: string } = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Your vote could not be saved. Try again.");
      } else {
        setJustSaved(true);
        router.refresh();
      }
    } catch {
      setError("Network error — your vote was not saved. Try again.");
    }
    setBusy(false);
  }

  return (
    <div className="glass-card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Vote className="h-4 w-4 text-accent" />
        <h2 className="text-base font-semibold">Vote</h2>
      </div>

      {/* ── Before voting opens ─────────────────────────────────────────── */}
      {!open && !closed && (
        <p className="text-sm text-muted">
          {status === "withdrawn"
            ? "This pitch was withdrawn before a vote."
            : "Voting hasn't opened yet. An officer opens it once the pitch has been presented in class — you'll get an email when it does."}
        </p>
      )}

      {/* ── Open ────────────────────────────────────────────────────────── */}
      {open && (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            Closes {formatDateTime(voteClosesAt)} ET
            {eligibleVoters !== null ? ` · ${eligibleVoters} eligible voters` : ""}
          </p>

          {canVote ? (
            <div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setChoice("yes")}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    choice === "yes"
                      ? "border-gain bg-gain/15 text-gain"
                      : "border-input-border bg-input-bg hover:bg-highlight"
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" /> Yes
                </button>
                <button
                  type="button"
                  onClick={() => setChoice("no")}
                  className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    choice === "no"
                      ? "border-loss bg-loss/15 text-loss"
                      : "border-input-border bg-input-bg hover:bg-highlight"
                  }`}
                >
                  <XCircle className="h-4 w-4" /> No
                </button>
              </div>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder="Optional comment (officers can read these)"
                className="mt-2 w-full rounded-lg border border-input-border bg-input-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
              {error && <p className="mt-2 text-sm text-loss">{error}</p>}
              <Button
                onClick={castVote}
                disabled={busy || choice === null}
                className="mt-2 w-full"
              >
                {busy
                  ? "Saving…"
                  : myVote
                    ? "Update my vote"
                    : "Cast my vote"}
              </Button>
              {myVote && (
                <p className="mt-2 text-center text-xs text-muted">
                  You voted{" "}
                  <span
                    className={
                      myVote.choice === "yes"
                        ? "font-medium text-gain"
                        : "font-medium text-loss"
                    }
                  >
                    {myVote.choice}
                  </span>
                  {justSaved ? " — updated." : " — you can change it until close."}
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-lg bg-highlight px-3 py-2 text-sm text-muted">
              {voteBlockedReason ?? "You are not eligible to vote on this pitch."}
            </p>
          )}

          {canViewIndividual ? (
            <div className="border-t border-card-border pt-4">
              <TallyCard
                yes={liveYes ?? 0}
                no={liveNo ?? 0}
                eligible={eligibleVoters}
                thresholdPct={thresholdPct}
                quorumPct={quorumPct}
                live
                myChoice={myVote?.choice ?? null}
                voters={voters}
              />
            </div>
          ) : (
            <div className="space-y-1 border-t border-card-border pt-3">
              {ballotsCast !== null && (
                <p className="flex items-center gap-1.5 text-sm">
                  <Users className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <span className="font-medium tabular-nums">{ballotsCast}</span>
                  {eligibleVoters !== null
                    ? ` of ${eligibleVoters} ballots in`
                    : " ballots in"}
                </p>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted">
                <Lock className="h-3 w-3 shrink-0" />
                The yes/no split stays sealed until the vote closes — results
                appear here for everyone once it does.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Closed ──────────────────────────────────────────────────────── */}
      {closed && (
        <TallyCard
          yes={votesYes}
          no={votesNo}
          eligible={eligibleVoters}
          thresholdPct={thresholdPct}
          quorumPct={quorumPct}
          resultPct={resultPct}
          outcome={status === "failed" ? "failed" : "passed"}
          myChoice={myVote?.choice ?? null}
          voters={canViewIndividual ? voters : null}
        />
      )}
    </div>
  );
}
