// Ballot options on a pitch vote (migration 0006): the allocations a vote
// chooses between, how ballots tally against them, and how an officer's edit
// to the list turns into database writes.
//
// The pass rule itself lives in SQL (close_pitch_vote). projectOutcome below
// mirrors it so the live tally can say how the vote would close right now;
// tests/ballot.test.ts pins the two together.

import type { VoteChoice, VoteOption, VoteOptionKind } from "@/types/domain";
import { formatCurrency, formatCurrencyWhole, formatPercent } from "@/lib/format";

export type BallotOption = Pick<VoteOption, "id" | "kind" | "label" | "amount" | "sort_order"> & {
  created_at?: string;
};

export interface BallotVote {
  choice: VoteChoice;
  option_id?: string | null;
}

/** The most options one ballot can carry. More than this is a survey. */
export const MAX_BALLOT_OPTIONS = 8;
export const MAX_LABEL_LENGTH = 200;

/** Ballot order: allocations as the officer listed them, then No. */
export function orderOptions<T extends BallotOption>(options: T[]): T[] {
  return [...options].sort(
    (a, b) =>
      Number(a.kind === "reject") - Number(b.kind === "reject") ||
      a.sort_order - b.sort_order ||
      (a.created_at ?? "").localeCompare(b.created_at ?? "")
  );
}

export function choiceForKind(kind: VoteOptionKind): "yes" | "no" {
  return kind === "approve" ? "yes" : "no";
}

/** The dollars an approve option stands for; null when nothing was pitched. */
export function optionAmount(
  option: Pick<BallotOption, "kind" | "amount">,
  proposedAmount: number | null
): number | null {
  if (option.kind !== "approve") return null;
  if (option.amount !== null && option.amount !== undefined) return Number(option.amount);
  return proposedAmount === null ? null : Number(proposedAmount);
}

/** An allocation in dollars: $60,000, or $60,000.50 when there are cents. */
export function formatAllocation(amount: number): string {
  return Number.isInteger(amount) ? formatCurrencyWhole(amount) : formatCurrency(amount);
}

/** What an option is called when the officer leaves the label blank. */
export function defaultLabel(kind: VoteOptionKind, amount: number | null): string {
  if (kind === "reject") return "No";
  return amount === null ? "Yes" : `Yes, at ${formatAllocation(amount)}`;
}

export interface OptionCount<T extends BallotOption = BallotOption> {
  option: T;
  count: number;
}

export interface BallotTally<T extends BallotOption = BallotOption> {
  rows: OptionCount<T>[];
  yes: number;
  no: number;
  abstain: number;
  /** Every ballot in, abstentions included: what turnout counts. */
  cast: number;
  /** The approve option with the most ballots; ties go to the one listed first. */
  leader: T | null;
}

export function tallyBallot<T extends BallotOption>(options: T[], votes: BallotVote[]): BallotTally<T> {
  const ordered = orderOptions(options);
  const counts = new Map<string, number>();
  let yes = 0;
  let no = 0;
  let abstain = 0;
  for (const v of votes) {
    if (v.choice === "yes") yes += 1;
    else if (v.choice === "no") no += 1;
    else abstain += 1;
    if (v.option_id) counts.set(v.option_id, (counts.get(v.option_id) ?? 0) + 1);
  }
  const rows = ordered.map((option) => ({ option, count: counts.get(option.id) ?? 0 }));
  let leader: T | null = null;
  let best = -1;
  for (const row of rows) {
    if (row.option.kind === "approve" && row.count > best) {
      leader = row.option;
      best = row.count;
    }
  }
  return { rows, yes, no, abstain, cast: yes + no + abstain, leader };
}

export interface OutcomeInput {
  yes: number;
  no: number;
  abstain: number;
  eligible: number | null;
  thresholdPct: number;
  quorumPct: number | null;
}

export interface Outcome {
  /** yes / (yes + no), two decimals; 0 when nobody took a side. */
  resultPct: number;
  /** Turnout with abstentions, as a percent of eligible; null when unknown. */
  turnoutPct: number | null;
  quorumMet: boolean;
  passes: boolean;
}

/** close_pitch_vote's rule, for a live read of where a vote stands. */
export function projectOutcome({
  yes,
  no,
  abstain,
  eligible,
  thresholdPct,
  quorumPct,
}: OutcomeInput): Outcome {
  const sides = yes + no;
  const turnoutPct =
    eligible !== null && eligible > 0 ? ((yes + no + abstain) / eligible) * 100 : null;
  if (sides === 0) {
    return { resultPct: 0, turnoutPct, quorumMet: false, passes: false };
  }
  const resultPct = Math.round((yes / sides) * 10_000) / 100;
  const quorumMet = quorumPct === null || turnoutPct === null || turnoutPct >= quorumPct;
  return { resultPct, turnoutPct, quorumMet, passes: resultPct >= thresholdPct && quorumMet };
}

/**
 * A yes option whose name disagrees with its amount: "Yes, at $60,000" set to
 * $50,000, or "as pitched" set to something other than the pitched amount.
 * Voters read the name and the ticket takes the amount, so the form warns.
 * `amount` is as entered (null: the pitched amount).
 */
export function labelMismatch(
  label: string,
  amount: number | null,
  proposedAmount: number | null
): string | null {
  const effective = amount ?? proposedAmount;
  if (effective === null) return null;
  const figures = label.match(/\$\s?\d[\d,]*(\.\d{1,2})?/g);
  if (figures && figures.length === 1) {
    const named = Number(figures[0].replace(/[$,\s]/g, ""));
    if (Math.abs(named - effective) >= 0.005) {
      return `The name says ${formatAllocation(named)} but the amount is ${formatAllocation(effective)}. Voters see the name; the ticket uses the amount.`;
    }
    return null;
  }
  if (
    /as pitched/i.test(label) &&
    proposedAmount !== null &&
    Math.abs(effective - proposedAmount) >= 0.005
  ) {
    return `The name says "as pitched" but the amount isn't the pitched ${formatAllocation(proposedAmount)}.`;
  }
  return null;
}

// ── On the page ─────────────────────────────────────────────────────────────

/** An option as the ballot shows it, with "as pitched" resolved to dollars. */
export interface BallotOptionView {
  id: string;
  kind: VoteOptionKind;
  label: string;
  amount: number | null;
}

export function toView(option: BallotOption, proposedAmount: number | null): BallotOptionView {
  return {
    id: option.id,
    kind: option.kind,
    label: option.label,
    amount: optionAmount(option, proposedAmount),
  };
}

/** What the voter has picked: an option id, or ABSTAIN. */
export type BallotPick = string;
export const ABSTAIN = "abstain";

/**
 * Stand-in ids for "Yes, as pitched" and "No" on a pitch nobody has saved a
 * ballot for yet. The page shows these; a vote for one posts a plain yes or
 * no, and the server sets the real options up on that first ballot.
 */
export const DEFAULT_YES = "default:approve";
export const DEFAULT_NO = "default:reject";

export function defaultOptions(proposedAmount: number | null): BallotOptionView[] {
  return [
    {
      id: DEFAULT_YES,
      kind: "approve",
      label: "Yes, as pitched",
      amount: proposedAmount !== null && proposedAmount > 0 ? proposedAmount : null,
    },
    { id: DEFAULT_NO, kind: "reject", label: "No", amount: null },
  ];
}

export function pickFromVote(
  vote: { choice: VoteChoice; optionId: string | null } | null,
  options: Pick<BallotOptionView, "id" | "kind">[]
): BallotPick | null {
  if (!vote) return null;
  if (vote.choice === "abstain") return ABSTAIN;
  if (vote.optionId && options.some((o) => o.id === vote.optionId)) return vote.optionId;
  // A ballot from before options existed: yes was the pitch as written.
  const kind = vote.choice === "yes" ? "approve" : "reject";
  return options.find((o) => o.kind === kind)?.id ?? null;
}

/** The amount to show beside a label, unless the label already says it. */
export function amountNote(option: Pick<BallotOptionView, "label" | "amount">): string | null {
  if (option.amount === null) return null;
  const money = formatAllocation(option.amount);
  return option.label.includes(money) ? null : money;
}

// ── After close ─────────────────────────────────────────────────────────────

/** What close_pitch_vote returns (jsonb). */
export interface CloseResult {
  status: string;
  result_pct: number | null;
  votes_yes: number;
  votes_no: number;
  /** Missing on a database without migration 0006. */
  votes_abstain?: number | null;
  winning_option_id?: string | null;
  eligible_voters?: number | null;
  ticket_id?: string | null;
  already_closed?: boolean;
  /** The rule the vote was judged under, frozen when it opened. */
  threshold_pct?: number | null;
  quorum_pct?: number | null;
}

/** "3 yes / 1 no / 1 abstained" */
export function tallyText(r: Pick<CloseResult, "votes_yes" | "votes_no" | "votes_abstain">): string {
  const abstain = Number(r.votes_abstain ?? 0);
  return `${r.votes_yes} yes / ${r.votes_no} no${abstain > 0 ? ` / ${abstain} abstained` : ""}`;
}

/** An option as one line: its label, plus its amount when the label doesn't say it. */
export function optionText(option: BallotOption, proposedAmount: number | null): string {
  const note = amountNote(toView(option, proposedAmount));
  return note === null ? option.label : `${option.label} (${note})`;
}

/**
 * The lines a result email opens with: the tally, and on a pass with more
 * than one way to vote yes, which allocation won.
 */
export function resultSummary(
  r: CloseResult,
  options: BallotOption[],
  proposedAmount: number | null
): string[] {
  const pct = formatPercent(r.result_pct === null ? null : Number(r.result_pct));
  const lines = [`The vote closed with ${tallyText(r)} (${pct} yes).`];
  const approves = options.filter((o) => o.kind === "approve");
  const winner = options.find((o) => o.id === r.winning_option_id);
  if (r.status === "passed" && winner && approves.length > 1) {
    lines.push(`The allocation that passed: ${optionText(winner, proposedAmount)}.`);
  }
  return lines;
}

// ── Editing the list ────────────────────────────────────────────────────────

export interface DraftOption {
  /** Set for an option already on the ballot. */
  id?: string;
  kind: VoteOptionKind;
  label: string;
  amount: number | null;
}

export interface ExistingOption extends BallotOption {
  /** Ballots cast for it so far. */
  ballots: number;
}

export interface BallotEditPlan {
  inserts: { kind: VoteOptionKind; label: string; amount: number | null; sort_order: number }[];
  updates: { id: string; label: string; amount: number | null; sort_order: number }[];
  deletes: string[];
  /** Ballots the edit clears: those for removed options or changed amounts. */
  cleared: number;
}

function sameAmount(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

/**
 * Turns the list an officer submits into inserts, updates and deletes, or
 * says what is wrong with it. The list is the whole ballot in order: every
 * allocation, then the one No. Options it leaves out are removed.
 */
export function planBallotEdit(
  existing: ExistingOption[],
  draft: DraftOption[]
): { plan: BallotEditPlan } | { error: string } {
  const byId = new Map(existing.map((o) => [o.id, o]));
  const approves = draft.filter((o) => o.kind === "approve");
  const rejects = draft.filter((o) => o.kind === "reject");

  if (approves.length === 0) return { error: "Keep at least one way to vote yes." };
  if (rejects.length !== 1) return { error: "A ballot has exactly one No." };
  if (draft.length > MAX_BALLOT_OPTIONS) {
    return { error: `A ballot holds at most ${MAX_BALLOT_OPTIONS} options.` };
  }
  const existingReject = existing.find((o) => o.kind === "reject");
  if (existingReject && rejects[0].id !== existingReject.id) {
    return { error: "The No option stays on the ballot; you can only reword it." };
  }

  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const cleaned: (DraftOption & { label: string })[] = [];
  for (const o of [...approves, ...rejects]) {
    if (o.id !== undefined) {
      const was = byId.get(o.id);
      if (!was) return { error: "One of those options is no longer on this ballot. Reload and try again." };
      if (was.kind !== o.kind) return { error: "An option can't switch between yes and no." };
      if (seenIds.has(o.id)) return { error: "The same option is listed twice." };
      seenIds.add(o.id);
    }
    const amount = o.kind === "reject" || o.amount === null ? null : Number(o.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      return { error: "Amounts have to be more than $0." };
    }
    const label = (o.label ?? "").trim() || defaultLabel(o.kind, amount);
    if (label.length > MAX_LABEL_LENGTH) {
      return { error: `Keep option names under ${MAX_LABEL_LENGTH} characters.` };
    }
    const key = label.toLowerCase();
    if (seenLabels.has(key)) return { error: `"${label}" is on the ballot twice.` };
    seenLabels.add(key);
    cleaned.push({ ...o, label, amount });
  }

  const plan: BallotEditPlan = { inserts: [], updates: [], deletes: [], cleared: 0 };
  cleaned.forEach((o, sort_order) => {
    if (o.id === undefined) {
      plan.inserts.push({ kind: o.kind, label: o.label, amount: o.amount, sort_order });
      return;
    }
    const was = byId.get(o.id) as ExistingOption;
    const amountChanged = !sameAmount(was.amount === null ? null : Number(was.amount), o.amount);
    if (amountChanged) plan.cleared += was.ballots;
    if (amountChanged || was.label !== o.label || was.sort_order !== sort_order) {
      plan.updates.push({ id: o.id, label: o.label, amount: o.amount, sort_order });
    }
  });
  for (const was of existing) {
    if (!seenIds.has(was.id)) {
      plan.deletes.push(was.id);
      plan.cleared += was.ballots;
    }
  }
  return { plan };
}
