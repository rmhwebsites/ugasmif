// Ballot options (migration 0006). The pass rule is close_pitch_vote's; the
// SQL suite in supabase/tests/ballots.sql runs the same three votes (P, R, S)
// against the real function, so a change to either side shows up here.

import { describe, expect, it } from "vitest";
import {
  defaultLabel,
  formatAllocation,
  labelMismatch,
  optionAmount,
  orderOptions,
  planBallotEdit,
  projectOutcome,
  tallyBallot,
  type BallotOption,
  type ExistingOption,
} from "@/lib/ballot";

const asPitched: BallotOption = { id: "y0", kind: "approve", label: "Yes, as pitched", amount: 120000, sort_order: 0 };
const at50: BallotOption = { id: "y1", kind: "approve", label: "Yes, at $50,000", amount: 50000, sort_order: 1 };
const no: BallotOption = { id: "n", kind: "reject", label: "No", amount: null, sort_order: 2 };

describe("orderOptions", () => {
  it("lists allocations in order, then No, whatever sort_order No has", () => {
    const misplacedNo = { ...no, sort_order: 0 };
    expect(orderOptions([at50, misplacedNo, asPitched]).map((o) => o.id)).toEqual(["y0", "y1", "n"]);
  });

  it("breaks a sort_order tie by when the option was added", () => {
    const a = { ...asPitched, sort_order: 1, created_at: "2026-11-02T10:00:00Z" };
    const b = { ...at50, sort_order: 1, created_at: "2026-11-02T09:00:00Z" };
    expect(orderOptions([a, b]).map((o) => o.id)).toEqual(["y1", "y0"]);
  });
});

describe("tallyBallot", () => {
  it("P: A as pitched, B and D at $50,000, C no; $50,000 leads", () => {
    const t = tallyBallot(
      [no, at50, asPitched],
      [
        { choice: "yes", option_id: "y0" },
        { choice: "yes", option_id: "y1" },
        { choice: "yes", option_id: "y1" },
        { choice: "no", option_id: "n" },
      ]
    );
    expect(t.rows.map((r) => [r.option.id, r.count])).toEqual([
      ["y0", 1],
      ["y1", 2],
      ["n", 1],
    ]);
    expect([t.yes, t.no, t.abstain, t.cast]).toEqual([3, 1, 0, 4]);
    expect(t.leader?.id).toBe("y1");
  });

  it("R: a tie between allocations goes to the one listed first", () => {
    const t = tallyBallot(
      [asPitched, at50, no],
      [
        { choice: "yes", option_id: "y0" },
        { choice: "yes", option_id: "y1" },
        { choice: "no", option_id: "n" },
        { choice: "abstain", option_id: null },
      ]
    );
    expect(t.leader?.id).toBe("y0");
    expect([t.yes, t.no, t.abstain, t.cast]).toEqual([2, 1, 1, 4]);
  });

  it("with no ballots, the pitch as written leads", () => {
    expect(tallyBallot([asPitched, at50, no], []).leader?.id).toBe("y0");
  });

  it("counts old ballots with no option on the yes/no sides only", () => {
    const t = tallyBallot([], [{ choice: "yes" }, { choice: "no" }]);
    expect([t.yes, t.no, t.cast]).toEqual([1, 1, 2]);
    expect(t.leader).toBeNull();
  });
});

describe("projectOutcome (close_pitch_vote's rule)", () => {
  const rule = { thresholdPct: 60, quorumPct: 50 };

  it("P passes at 75%", () => {
    const o = projectOutcome({ yes: 3, no: 1, abstain: 0, eligible: 4, ...rule });
    expect(o.resultPct).toBe(75);
    expect(o.passes).toBe(true);
  });

  it("R passes at 66.67%: an abstention is not a no", () => {
    const o = projectOutcome({ yes: 2, no: 1, abstain: 1, eligible: 4, ...rule });
    expect(o.resultPct).toBe(66.67);
    expect(o.passes).toBe(true);
  });

  it("S passes a 75% quorum because abstentions count toward turnout", () => {
    const o = projectOutcome({ yes: 1, no: 0, abstain: 2, eligible: 4, thresholdPct: 60, quorumPct: 75 });
    expect(o.turnoutPct).toBe(75);
    expect(o.quorumMet).toBe(true);
    expect(o.passes).toBe(true);
  });

  it("fails when everyone abstains", () => {
    const o = projectOutcome({ yes: 0, no: 0, abstain: 4, eligible: 4, ...rule });
    expect(o.resultPct).toBe(0);
    expect(o.passes).toBe(false);
  });

  it("fails under quorum even when the yeses clear the bar", () => {
    const o = projectOutcome({ yes: 2, no: 0, abstain: 0, eligible: 10, ...rule });
    expect(o.quorumMet).toBe(false);
    expect(o.passes).toBe(false);
  });

  it("ignores the quorum when there is none or nobody is on record", () => {
    expect(projectOutcome({ yes: 1, no: 0, abstain: 0, eligible: 10, thresholdPct: 60, quorumPct: null }).passes).toBe(true);
    expect(projectOutcome({ yes: 1, no: 0, abstain: 0, eligible: 0, ...rule }).passes).toBe(true);
  });
});

describe("optionAmount and labels", () => {
  it("an approve option with no amount means the amount pitched", () => {
    expect(optionAmount({ kind: "approve", amount: null }, 80000)).toBe(80000);
    expect(optionAmount({ kind: "approve", amount: 40000 }, 80000)).toBe(40000);
    expect(optionAmount({ kind: "reject", amount: null }, 80000)).toBeNull();
    expect(optionAmount({ kind: "approve", amount: null }, null)).toBeNull();
  });

  it("reads amounts that arrive from Postgres as strings", () => {
    expect(optionAmount({ kind: "approve", amount: "60000.00" as unknown as number }, null)).toBe(60000);
  });

  it("names an unnamed option after its amount", () => {
    expect(defaultLabel("approve", 60000)).toBe("Yes, at $60,000");
    expect(defaultLabel("approve", null)).toBe("Yes");
    expect(defaultLabel("reject", 5)).toBe("No");
    expect(formatAllocation(60000.5)).toBe("$60,000.50");
  });
});

describe("labelMismatch", () => {
  it("catches a name that quotes a different amount", () => {
    expect(labelMismatch("Yes, at $60,000", 50000, 120000)).toBe(
      "The name says $60,000 but the amount is $50,000. Voters see the name; the ticket uses the amount."
    );
    expect(labelMismatch("Yes, at $60,000", 60000, 120000)).toBeNull();
    expect(labelMismatch("Yes, at $ 60,000.00", 60000, null)).toBeNull();
  });

  it("catches \"as pitched\" at an amount that wasn't pitched", () => {
    expect(labelMismatch("Yes, as pitched", 100000, 120000)).toBe(
      'The name says "as pitched" but the amount isn\'t the pitched $120,000.'
    );
    expect(labelMismatch("Yes, as pitched", null, 120000)).toBeNull();
    expect(labelMismatch("Yes, as pitched", 120000, 120000)).toBeNull();
  });

  it("leaves names with no figure, or two, alone", () => {
    expect(labelMismatch("Half size", 50000, 120000)).toBeNull();
    expect(labelMismatch("Sell $20,000 of X, buy $40,000", 40000, null)).toBeNull();
    expect(labelMismatch("Yes, at $60,000", null, null)).toBeNull();
  });
});

describe("planBallotEdit", () => {
  const existing: ExistingOption[] = [
    { ...asPitched, ballots: 3 },
    { ...at50, ballots: 2 },
    { ...no, ballots: 1 },
  ];
  const keep = (o: BallotOption) => ({ id: o.id, kind: o.kind, label: o.label, amount: o.amount });

  it("an unchanged list writes nothing", () => {
    const r = planBallotEdit(existing, [keep(asPitched), keep(at50), keep(no)]);
    expect(r).toEqual({ plan: { inserts: [], updates: [], deletes: [], cleared: 0 } });
  });

  it("adds an alternative before No and moves No down", () => {
    const r = planBallotEdit(existing, [
      keep(asPitched),
      keep(at50),
      { kind: "approve", label: "", amount: 30000 },
      keep(no),
    ]);
    if (!("plan" in r)) throw new Error(r.error);
    expect(r.plan.inserts).toEqual([{ kind: "approve", label: "Yes, at $30,000", amount: 30000, sort_order: 2 }]);
    expect(r.plan.updates).toEqual([{ id: "n", label: "No", amount: null, sort_order: 3 }]);
    expect(r.plan.cleared).toBe(0);
  });

  it("rewording keeps ballots; a new amount clears them", () => {
    const reworded = planBallotEdit(existing, [keep(asPitched), { ...keep(at50), label: "Half size" }, keep(no)]);
    if (!("plan" in reworded)) throw new Error(reworded.error);
    expect(reworded.plan.cleared).toBe(0);

    const resized = planBallotEdit(existing, [keep(asPitched), { ...keep(at50), amount: 45000 }, keep(no)]);
    if (!("plan" in resized)) throw new Error(resized.error);
    expect(resized.plan.updates).toEqual([{ id: "y1", label: "Yes, at $50,000", amount: 45000, sort_order: 1 }]);
    expect(resized.plan.cleared).toBe(2);
  });

  it("does not treat 50000 and \"50000.00\" as a change", () => {
    const fromDb = existing.map((o) => ({ ...o, amount: o.amount === null ? null : (`${o.amount}.00` as unknown as number) }));
    const r = planBallotEdit(fromDb, [keep(asPitched), keep(at50), keep(no)]);
    if (!("plan" in r)) throw new Error(r.error);
    expect(r.plan.cleared).toBe(0);
  });

  it("removing an alternative clears its ballots", () => {
    const r = planBallotEdit(existing, [keep(asPitched), keep(no)]);
    if (!("plan" in r)) throw new Error(r.error);
    expect(r.plan.deletes).toEqual(["y1"]);
    expect(r.plan.cleared).toBe(2);
  });

  it("refuses a ballot without a yes, without its No, or with two Nos", () => {
    expect(planBallotEdit(existing, [keep(no)])).toEqual({ error: "Keep at least one way to vote yes." });
    expect(planBallotEdit(existing, [keep(asPitched)])).toEqual({ error: "A ballot has exactly one No." });
    expect(planBallotEdit(existing, [keep(asPitched), keep(no), { kind: "reject", label: "Never", amount: null }])).toEqual({
      error: "A ballot has exactly one No.",
    });
    expect(planBallotEdit(existing, [keep(asPitched), { kind: "reject", label: "No", amount: null }])).toEqual({
      error: "The No option stays on the ballot; you can only reword it.",
    });
  });

  it("refuses bad amounts, duplicate names, and ids from elsewhere", () => {
    expect(planBallotEdit(existing, [keep(asPitched), { kind: "approve", label: "x", amount: 0 }, keep(no)])).toEqual({
      error: "Amounts have to be more than $0.",
    });
    expect(planBallotEdit(existing, [keep(asPitched), { kind: "approve", label: "yes, AS pitched", amount: 1 }, keep(no)])).toEqual({
      error: '"yes, AS pitched" is on the ballot twice.',
    });
    expect(planBallotEdit(existing, [{ ...keep(asPitched), id: "elsewhere" }, keep(no)])).toEqual({
      error: "One of those options is no longer on this ballot. Reload and try again.",
    });
    expect(planBallotEdit(existing, [keep(asPitched), { ...keep(no), kind: "approve" }, keep(no)])).toEqual({
      error: "An option can't switch between yes and no.",
    });
  });

  it("caps the ballot at eight options", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ kind: "approve" as const, label: `Option ${i}`, amount: 1000 * (i + 1) }));
    expect(planBallotEdit(existing, [...many, keep(no)])).toEqual({ error: "A ballot holds at most 8 options." });
  });

  it("sets up a first ballot from nothing", () => {
    const r = planBallotEdit([], [
      { kind: "approve", label: "Yes, as pitched", amount: 120000 },
      { kind: "reject", label: "No", amount: null },
    ]);
    if (!("plan" in r)) throw new Error(r.error);
    expect(r.plan.inserts.map((o) => o.sort_order)).toEqual([0, 1]);
  });
});
