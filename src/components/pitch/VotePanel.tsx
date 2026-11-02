"use client";

// Cast / change a vote while the window is open (SPEC Section 12). What the
// viewer may see is decided server-side and passed down: members get their
// own ballot state plus how many ballots are in, never the split;
// officers/advisor (canViewIndividual) also get the live count per option
// and the voter roll via TallyCard. After close everyone sees the yes/no
// counts, the percentage, the pass/fail badge and the allocation that
// passed; the count per option and names stay officer-only.
//
// A ballot is a list of options (migration 0006): the pitch as written, any
// alternative allocations an officer added, No, and Abstain. Officers edit
// the list from this card, before voting opens or while it's open.
//
// The card carries id="vote": every "Vote" link in the app points at
// /[fund]/pitches/<id>#vote, which matters on a phone, where this card sits
// below the chart, the thesis and the deck.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Lock, MinusCircle, Pencil, Trophy, Users, Vote, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TallyCard, type TallyOption, type TallyVoter } from "@/components/pitch/TallyCard";
import { BallotChoices, castBallot } from "@/components/pitch/BallotChoices";
import { BallotEditor, type EditableOption } from "@/components/pitch/BallotEditor";
import { ABSTAIN, amountNote, pickFromVote, type BallotOptionView, type BallotPick } from "@/lib/ballot";
import { formatDateTime } from "@/lib/format";
import type { PitchStatus, VoteChoice } from "@/types/domain";

export function VotePanel({
  fund,
  pitchId,
  status,
  voteClosesAt,
  votesYes,
  votesNo,
  votesAbstain = 0,
  resultPct,
  eligibleVoters,
  thresholdPct,
  quorumPct,
  canVote,
  voteBlockedReason,
  canViewIndividual,
  options,
  optionCounts = null,
  winningOptionId = null,
  leadingOptionId = null,
  myVote,
  ballotsCast = null,
  liveYes = null,
  liveNo = null,
  liveAbstain = null,
  voters = null,
  editor = null,
}: {
  fund: string;
  pitchId: string;
  status: PitchStatus;
  voteClosesAt: string | null;
  /** Stored tallies from the pitch row (set at close). */
  votesYes: number;
  votesNo: number;
  votesAbstain?: number;
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
  /** The ballot in order. Empty for a vote that closed before options existed. */
  options: BallotOptionView[];
  /** Ballots per option id — only for viewers holding view_individual_votes. */
  optionCounts?: Record<string, number> | null;
  /** The allocation that passed, stored at close. */
  winningOptionId?: string | null;
  /** While open, the yes option with the most ballots (officer view). */
  leadingOptionId?: string | null;
  myVote: { choice: VoteChoice; optionId: string | null; comment: string | null } | null;
  /** Total ballots cast so far — the count members may see, never the split. */
  ballotsCast?: number | null;
  /** Live counts — only passed when the viewer holds view_individual_votes. */
  liveYes?: number | null;
  liveNo?: number | null;
  liveAbstain?: number | null;
  voters?: TallyVoter[] | null;
  /** The ballot as officers edit it; null for everyone else, and once closed. */
  editor?: { options: EditableOption[]; proposedAmount: number | null } | null;
}) {
  const router = useRouter();
  const [pick, setPick] = useState<BallotPick | null>(pickFromVote(myVote, options));
  const [comment, setComment] = useState(myVote?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const open = status === "voting";
  const closed = status === "passed" || status === "failed" || status === "executed";
  const myPick = pickFromVote(myVote, options);
  const myOption = options.find((o) => o.id === myPick) ?? null;

  async function submit() {
    if (!pick) {
      setError("Pick an option first.");
      return;
    }
    setBusy(true);
    setError(null);
    setJustSaved(false);
    const result = await castBallot(fund, pitchId, pick, comment);
    if (result.ok) {
      setJustSaved(true);
      router.refresh();
    } else {
      setError(result.error ?? "Your vote could not be saved. Try again.");
      if (result.stale) {
        setPick(null);
        router.refresh();
      }
    }
    setBusy(false);
  }

  const tallyOptions: TallyOption[] | null =
    optionCounts && options.length > 0
      ? options.map((o) => ({ ...o, count: optionCounts[o.id] ?? 0 }))
      : null;
  const winner = options.find((o) => o.id === winningOptionId) ?? null;
  const approveCount = options.filter((o) => o.kind === "approve").length;

  return (
    <div id="vote" className="glass-card scroll-mt-20 p-4 sm:p-5 lg:scroll-mt-6">
      <div className="mb-3 flex items-center gap-2">
        <Vote className="h-4 w-4 text-accent-text" />
        <h2 className="text-base font-semibold">Vote</h2>
        {editor && !editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setNotice(null);
            }}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-accent-text transition-colors hover:bg-highlight"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit options
          </button>
        )}
      </div>

      {notice && !editing && (
        <p className="mb-3 rounded-lg bg-highlight px-3 py-2 text-sm">{notice}</p>
      )}

      {editing && editor ? (
        <BallotEditor
          fund={fund}
          pitchId={pitchId}
          options={editor.options}
          proposedAmount={editor.proposedAmount}
          voting={open}
          onClose={(saved) => {
            setEditing(false);
            if (saved) setNotice(saved);
          }}
        />
      ) : (
        <>
          {/* ── Before voting opens ─────────────────────────────────────── */}
          {!open && !closed && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {status === "withdrawn"
                  ? "This pitch was withdrawn before a vote."
                  : "Voting hasn't opened yet. An officer opens it once the pitch has been presented in class, and voters get an email when it does."}
              </p>
              {status !== "withdrawn" && options.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted">On the ballot</p>
                  <ul className="space-y-1 text-sm">
                    {options.map((o) => (
                      <li key={o.id} className="flex items-center gap-2">
                        {o.kind === "approve" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-gain" aria-hidden />
                        ) : (
                          <XCircle className="h-3.5 w-3.5 shrink-0 text-loss" aria-hidden />
                        )}
                        <span>{o.label}</span>
                        {amountNote(o) && (
                          <span className="ml-auto tabular-nums text-muted">{amountNote(o)}</span>
                        )}
                      </li>
                    ))}
                    <li className="flex items-center gap-2 text-muted">
                      <MinusCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      Abstain
                    </li>
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Open ──────────────────────────────────────────────────── */}
          {open && (
            <div className="space-y-4">
              <p className="text-xs text-muted">
                Closes {formatDateTime(voteClosesAt)} ET
                {eligibleVoters !== null ? ` · ${eligibleVoters} eligible voters` : ""}
              </p>

              {canVote ? (
                <div>
                  <BallotChoices
                    name={`ballot-${pitchId}`}
                    options={options}
                    value={pick}
                    onChange={(p) => {
                      setPick(p);
                      setError(null);
                    }}
                    disabled={busy}
                  />
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
                    onClick={submit}
                    disabled={busy || pick === null}
                    className="mt-2 w-full"
                  >
                    {busy ? "Saving…" : myVote ? "Update my vote" : "Cast my vote"}
                  </Button>
                  {myVote && (
                    <p className="mt-2 text-center text-xs text-muted">
                      {myPick === ABSTAIN ? (
                        "You abstained"
                      ) : (
                        <>
                          You voted{" "}
                          <span
                            className={
                              myVote.choice === "yes"
                                ? "font-medium text-gain"
                                : "font-medium text-loss"
                            }
                          >
                            {myOption?.label ?? myVote.choice}
                          </span>
                        </>
                      )}
                      {justSaved ? ". Updated." : ". You can change it until close."}
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
                    abstain={liveAbstain ?? 0}
                    eligible={eligibleVoters}
                    thresholdPct={thresholdPct}
                    quorumPct={quorumPct}
                    live
                    myChoice={myVote?.choice ?? null}
                    myOptionId={myPick}
                    options={tallyOptions}
                    winningOptionId={approveCount > 1 ? leadingOptionId : null}
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
                    How the votes split stays sealed until the vote closes.
                    Results appear here for everyone once it does.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Closed ────────────────────────────────────────────────── */}
          {closed && (
            <div className="space-y-3">
              {status !== "failed" && winner && approveCount > 1 && (
                <p className="flex items-center gap-2 rounded-lg bg-gain/10 px-3 py-2 text-sm">
                  <Trophy className="h-4 w-4 shrink-0 text-gain" aria-hidden />
                  <span>
                    Allocation that passed:{" "}
                    <span className="font-semibold">{winner.label}</span>
                    {amountNote(winner) ? ` · ${amountNote(winner)}` : ""}
                  </span>
                </p>
              )}
              <TallyCard
                yes={votesYes}
                no={votesNo}
                abstain={votesAbstain}
                eligible={eligibleVoters}
                thresholdPct={thresholdPct}
                quorumPct={quorumPct}
                resultPct={resultPct}
                outcome={status === "failed" ? "failed" : "passed"}
                myChoice={myVote?.choice ?? null}
                myOptionId={myPick}
                options={tallyOptions}
                winningOptionId={approveCount > 1 ? winningOptionId : null}
                voters={canViewIndividual ? voters : null}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
