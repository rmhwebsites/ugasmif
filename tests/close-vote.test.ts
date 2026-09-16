// A pure-TypeScript mirror of the threshold math inside the SQL function
// `close_pitch_vote(p_pitch_id uuid)` in supabase/migrations/0001_init.sql.
//
// The SQL is the source of truth; this file pins its semantics so a change to
// the rule shows up as a failing test instead of a surprise on vote night:
//
//   yes + no = 0                  -> result 0.00, failed
//   otherwise result_pct          = round(yes / (yes + no) * 100, 2)
//   eligible_voters               = pitches.eligible_voters, captured when the
//                                   vote opened, else the live count of active
//                                   non-viewer memberships for the year
//   quorum (only when funds.vote_quorum_pct is set and eligible > 0)
//                                 = (yes + no) / eligible * 100 >= quorum_pct
//   passed                        = result_pct >= funds.vote_pass_threshold_pct
//                                   AND quorum ok
//
// Note on rounding: Postgres `round(numeric, 2)` is exact decimal, half away
// from zero. The helper below rounds IEEE doubles, so a tally that lands on an
// exact half cent (e.g. 59.995%) can differ in the last digit. Real vote
// counts are small integers and never reach that case.

import { describe, it, expect } from "vitest";

type CloseVoteStatus = "passed" | "failed";

interface CloseVoteInput {
  votesYes: number;
  votesNo: number;
  /** funds.vote_pass_threshold_pct (60.00 for both SMIF funds) */
  passThresholdPct: number;
  /** funds.vote_quorum_pct — null means no quorum rule */
  quorumPct?: number | null;
  /** pitches.eligible_voters, snapshotted when voting opened */
  eligibleVoters?: number | null;
  /** live fallback: active, non-viewer memberships in the fund this year */
  activeVoterCount?: number;
}

interface CloseVoteResult {
  status: CloseVoteStatus;
  result_pct: number;
  votes_yes: number;
  votes_no: number;
  eligible_voters: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function closePitchVote(input: CloseVoteInput): CloseVoteResult {
  const {
    votesYes,
    votesNo,
    passThresholdPct,
    quorumPct = null,
    eligibleVoters = null,
    activeVoterCount = 0,
  } = input;

  const cast = votesYes + votesNo;
  const eligible = eligibleVoters ?? activeVoterCount;

  if (cast === 0) {
    return {
      status: "failed",
      result_pct: 0,
      votes_yes: votesYes,
      votes_no: votesNo,
      eligible_voters: eligible,
    };
  }

  const resultPct = round2((votesYes / cast) * 100);

  let quorumOk = true;
  if (quorumPct !== null && eligible > 0) {
    quorumOk = (cast / eligible) * 100 >= quorumPct;
  }

  return {
    status: resultPct >= passThresholdPct && quorumOk ? "passed" : "failed",
    result_pct: resultPct,
    votes_yes: votesYes,
    votes_no: votesNo,
    eligible_voters: eligible,
  };
}

const THRESHOLD = 60;

describe("close_pitch_vote: pass threshold", () => {
  it("passes at exactly 60.00% of votes cast", () => {
    const result = closePitchVote({
      votesYes: 3,
      votesNo: 2,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 5,
    });
    expect(result.result_pct).toBe(60);
    expect(result.status).toBe("passed");
  });

  it("passes on a larger tally that lands on 60.00%", () => {
    const result = closePitchVote({
      votesYes: 18,
      votesNo: 12,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 34,
    });
    expect(result.result_pct).toBe(60);
    expect(result.status).toBe("passed");
  });

  it("fails at 59.99%", () => {
    const result = closePitchVote({
      votesYes: 5_999,
      votesNo: 4_001,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 10_000,
    });
    expect(result.result_pct).toBe(59.99);
    expect(result.status).toBe("failed");
  });

  it("fails just under the line on a realistic tally", () => {
    const result = closePitchVote({
      votesYes: 17,
      votesNo: 12,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 34,
    });
    expect(result.result_pct).toBe(58.62);
    expect(result.status).toBe("failed");
  });

  it("reads the threshold from the fund, not a constant", () => {
    const tally = { votesYes: 13, votesNo: 7, eligibleVoters: 25 };
    expect(closePitchVote({ ...tally, passThresholdPct: 60 }).status).toBe("passed");
    expect(closePitchVote({ ...tally, passThresholdPct: 66.67 }).status).toBe(
      "failed"
    );
    expect(closePitchVote({ ...tally, passThresholdPct: 65 }).result_pct).toBe(65);
    expect(closePitchVote({ ...tally, passThresholdPct: 65 }).status).toBe("passed");
  });
});

describe("close_pitch_vote: no votes", () => {
  it("fails with result 0 when nobody voted", () => {
    const result = closePitchVote({
      votesYes: 0,
      votesNo: 0,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 34,
    });
    expect(result.status).toBe("failed");
    expect(result.result_pct).toBe(0);
    expect(result.votes_yes).toBe(0);
    expect(result.votes_no).toBe(0);
    expect(result.eligible_voters).toBe(34);
  });

  it("fails with result 0 even when a quorum rule is set", () => {
    const result = closePitchVote({
      votesYes: 0,
      votesNo: 0,
      passThresholdPct: THRESHOLD,
      quorumPct: 50,
      eligibleVoters: 34,
    });
    expect(result.status).toBe("failed");
    expect(result.result_pct).toBe(0);
  });

  it("fails a unanimous no vote", () => {
    const result = closePitchVote({
      votesYes: 0,
      votesNo: 9,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 34,
    });
    expect(result.result_pct).toBe(0);
    expect(result.status).toBe("failed");
  });
});

describe("close_pitch_vote: quorum", () => {
  it("passes when the quorum is met and the threshold is cleared", () => {
    // 24 of 34 eligible voted (70.6% turnout) and 75% said yes
    const result = closePitchVote({
      votesYes: 18,
      votesNo: 6,
      passThresholdPct: THRESHOLD,
      quorumPct: 50,
      eligibleVoters: 34,
    });
    expect(result.result_pct).toBe(75);
    expect(result.status).toBe("passed");
  });

  it("fails when the threshold is cleared but the quorum is not", () => {
    // 8 of 34 eligible voted (23.5% turnout), 87.5% of them yes
    const result = closePitchVote({
      votesYes: 7,
      votesNo: 1,
      passThresholdPct: THRESHOLD,
      quorumPct: 50,
      eligibleVoters: 34,
    });
    expect(result.result_pct).toBe(87.5);
    expect(result.status).toBe("failed");
  });

  it("treats turnout exactly at the quorum as met", () => {
    // 17 of 34 eligible = 50.0% turnout, quorum 50
    const result = closePitchVote({
      votesYes: 11,
      votesNo: 6,
      passThresholdPct: THRESHOLD,
      quorumPct: 50,
      eligibleVoters: 34,
    });
    expect(result.result_pct).toBe(64.71);
    expect(result.status).toBe("passed");
  });

  it("ignores the quorum when the fund has none", () => {
    const result = closePitchVote({
      votesYes: 7,
      votesNo: 1,
      passThresholdPct: THRESHOLD,
      quorumPct: null,
      eligibleVoters: 34,
    });
    expect(result.status).toBe("passed");
  });

  it("ignores the quorum when there are no eligible voters on record", () => {
    const result = closePitchVote({
      votesYes: 7,
      votesNo: 1,
      passThresholdPct: THRESHOLD,
      quorumPct: 50,
      eligibleVoters: 0,
    });
    expect(result.eligible_voters).toBe(0);
    expect(result.status).toBe("passed");
  });
});

describe("close_pitch_vote: eligible voter count", () => {
  it("prefers the count captured when voting opened", () => {
    const result = closePitchVote({
      votesYes: 9,
      votesNo: 3,
      passThresholdPct: THRESHOLD,
      quorumPct: 50,
      eligibleVoters: 20, // snapshot: 12/20 = 60% turnout, quorum met
      activeVoterCount: 40, // roster grew after the vote opened
    });
    expect(result.eligible_voters).toBe(20);
    expect(result.status).toBe("passed");
  });

  it("falls back to the live active-voter count when the pitch has none", () => {
    const result = closePitchVote({
      votesYes: 9,
      votesNo: 3,
      passThresholdPct: THRESHOLD,
      quorumPct: 50,
      eligibleVoters: null,
      activeVoterCount: 40, // 12/40 = 30% turnout, quorum missed
    });
    expect(result.eligible_voters).toBe(40);
    expect(result.status).toBe("failed");
  });
});

describe("close_pitch_vote: result_pct is yes / (yes + no) * 100", () => {
  it("ignores abstentions — only votes cast count", () => {
    const result = closePitchVote({
      votesYes: 18,
      votesNo: 5,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 34, // 11 people never voted; they do not dilute the result
    });
    expect(result.result_pct).toBe(78.26);
    expect(result.status).toBe("passed");
  });

  it("rounds to two decimals", () => {
    expect(
      closePitchVote({ votesYes: 2, votesNo: 1, passThresholdPct: THRESHOLD })
        .result_pct
    ).toBe(66.67);
    expect(
      closePitchVote({ votesYes: 1, votesNo: 2, passThresholdPct: THRESHOLD })
        .result_pct
    ).toBe(33.33);
    expect(
      closePitchVote({ votesYes: 6, votesNo: 20, passThresholdPct: THRESHOLD })
        .result_pct
    ).toBe(23.08);
  });

  it("reproduces the published SMIF results", () => {
    // SPEC Section 2: General Dynamics passed at 78%, Ares Capital failed at 23%.
    const gd = closePitchVote({
      votesYes: 18,
      votesNo: 5,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 34,
    });
    expect(Math.round(gd.result_pct)).toBe(78);
    expect(gd.status).toBe("passed");

    const ares = closePitchVote({
      votesYes: 6,
      votesNo: 20,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 34,
    });
    expect(Math.round(ares.result_pct)).toBe(23);
    expect(ares.status).toBe("failed");
  });

  it("returns the tally it was given", () => {
    const result = closePitchVote({
      votesYes: 12,
      votesNo: 4,
      passThresholdPct: THRESHOLD,
      eligibleVoters: 30,
    });
    expect(result.votes_yes).toBe(12);
    expect(result.votes_no).toBe(4);
    expect(result.eligible_voters).toBe(30);
  });
});
