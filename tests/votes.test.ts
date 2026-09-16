// voteRule() decides which pass rule a pitch is judged under (SPEC Section 12).
// It has to agree with close_pitch_vote in migration 0004 — the SQL side is
// covered by supabase/tests/policies.sql, this covers the UI side.

import { describe, it, expect } from "vitest";
import { voteRule } from "@/lib/votes";
import type { Fund, Pitch } from "@/types/domain";

type RuleFund = Pick<Fund, "vote_pass_threshold_pct" | "vote_quorum_pct">;
type RulePitch = Pick<Pitch, "threshold_pct" | "quorum_pct">;

const fund = (threshold: number, quorum: number | null): RuleFund => ({
  vote_pass_threshold_pct: threshold,
  vote_quorum_pct: quorum,
});

const pitch = (
  threshold: number | null,
  quorum: number | null
): RulePitch => ({ threshold_pct: threshold, quorum_pct: quorum });

describe("voteRule", () => {
  it("prefers the rule frozen on the pitch", () => {
    expect(voteRule(pitch(60, 50), fund(90, 75))).toEqual({
      thresholdPct: 60,
      quorumPct: 50,
    });
  });

  it("falls back to the fund when nothing was frozen", () => {
    expect(voteRule(pitch(null, null), fund(90, 75))).toEqual({
      thresholdPct: 90,
      quorumPct: 75,
    });
  });

  it("keeps a frozen null quorum instead of inheriting the fund's", () => {
    // The case that makes threshold_pct, not quorum_pct, the marker: a vote
    // opened with no quorum must not acquire one the officers added later.
    expect(voteRule(pitch(60, null), fund(90, 100))).toEqual({
      thresholdPct: 60,
      quorumPct: null,
    });
  });

  it("carries the fund's null quorum through the fallback", () => {
    expect(voteRule(pitch(null, null), fund(60, null))).toEqual({
      thresholdPct: 60,
      quorumPct: null,
    });
  });

  it("coerces the numeric strings postgrest returns", () => {
    // numeric(5,2) arrives as a string over PostgREST, so a bare comparison
    // against a number would be wrong in both directions.
    const raw = { threshold_pct: "66.67", quorum_pct: "25.00" };
    expect(voteRule(raw as unknown as RulePitch, fund(90, 75))).toEqual({
      thresholdPct: 66.67,
      quorumPct: 25,
    });
  });

  it("treats absent columns like nulls", () => {
    // Before migration 0004 lands, select("*") returns no such columns at
    // all; reading undefined as "frozen" would render NaN%.
    expect(voteRule({}, fund(60, 25))).toEqual({
      thresholdPct: 60,
      quorumPct: 25,
    });
    expect(voteRule({ threshold_pct: 70 }, fund(60, 25))).toEqual({
      thresholdPct: 70,
      quorumPct: null,
    });
  });

  it("treats a zero threshold as frozen, not missing", () => {
    expect(voteRule(pitch(0, null), fund(60, 50)).thresholdPct).toBe(0);
  });
});
