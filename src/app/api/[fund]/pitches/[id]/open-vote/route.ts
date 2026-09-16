// POST /api/[fund]/pitches/[id]/open-vote — submitted/scheduled → voting
// (SPEC Section 12). Officers only. The transition's side effects live in
// openPitchVote() below: vote_opens_at = now, vote_closes_at = now +
// fund.vote_default_window_hours (overridable via window_hours), frozen
// eligible_voters (active members, role != viewer), audit, and an email to
// every eligible voter — always sent. The auto-open cron
// (/api/cron/votes) calls the same function so the manual and automatic
// paths cannot drift.

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { sendToFund } from "@/lib/emails/send";
import { formatDateTime } from "@/lib/format";
import type { Fund, MembershipRole, Pitch } from "@/types/domain";

const bodySchema = z.object({
  /** Override of fund.vote_default_window_hours for this vote. */
  window_hours: z.number().int().min(1).max(336).optional(),
});

const VOTER_ROLES: MembershipRole[] = [
  "president",
  "vice_president",
  "portfolio_manager",
  "alumni_relations",
  "sector_leader",
  "analyst",
];

export interface OpenVoteResult {
  pitch: Pitch;
  eligibleVoters: number;
  windowHours: number;
  closesAt: Date;
}

/**
 * Opens voting on one pitch and applies every side effect the spec lists for
 * the transition. The caller has already checked permission and that the
 * pitch is in an openable state; a failed update throws.
 */
export async function openPitchVote(
  supabase: SupabaseClient,
  {
    fund,
    yearId,
    pitch,
    actorId,
    windowHours,
  }: {
    fund: Fund;
    /** Academic year the eligible-voter count is taken from. */
    yearId: string;
    pitch: Pitch;
    actorId: string | null;
    windowHours?: number;
  }
): Promise<OpenVoteResult> {
  // Freeze the voting population now, so the stored result never depends on
  // later roster edits (SPEC Section 12 rules).
  const { count } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", fund.id)
    .eq("academic_year_id", yearId)
    .eq("status", "active")
    .neq("role", "viewer");
  const eligible = count ?? 0;

  const fundDefault = Number(fund.vote_default_window_hours);
  const hours =
    windowHours ??
    (Number.isFinite(fundDefault) && fundDefault >= 1 ? fundDefault : 24);
  const opens = new Date();
  const closes = new Date(opens.getTime() + hours * 3_600_000);

  const { data: updated, error } = await supabase
    .from("pitches")
    .update({
      status: "voting",
      vote_opens_at: opens.toISOString(),
      vote_closes_at: closes.toISOString(),
      eligible_voters: eligible,
      // Freeze the rule too, not just the population: a threshold changed
      // mid-vote must not move the bar under the people already voting.
      threshold_pct: Number(fund.vote_pass_threshold_pct),
      quorum_pct:
        fund.vote_quorum_pct === null ? null : Number(fund.vote_quorum_pct),
    })
    .eq("id", pitch.id)
    .select("*")
    .single();
  if (error || !updated) {
    throw new Error(error?.message ?? "Voting could not be opened");
  }

  await logAudit(supabase, {
    actorId,
    fundId: fund.id,
    action: "pitch.open_vote",
    entity: "pitches",
    entityId: pitch.id,
    before: { status: pitch.status },
    after: {
      status: "voting",
      vote_opens_at: opens.toISOString(),
      vote_closes_at: closes.toISOString(),
      eligible_voters: eligible,
      window_hours: hours,
    },
  });

  // "Vote open" is one of the always-sent emails (SPEC Section 16).
  await sendToFund(supabase, fund.id, {
    subject: `Vote open: ${pitch.title} — closes ${formatDateTime(closes)} ET`,
    heading: "A vote is open",
    bodyLines: [
      `Voting on "${pitch.title}" is open now and closes ${formatDateTime(closes)} ET.`,
      "You can change your ballot any time before it closes.",
    ],
    ctaLabel: "Cast your vote",
    ctaPath: `/${fund.slug}/pitches/${pitch.id}`,
    roles: VOTER_ROLES,
    essential: true,
  });

  return {
    pitch: updated as Pitch,
    eligibleVoters: eligible,
    windowHours: hours,
    closesAt: closes,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "schedule_pitch")) {
    return NextResponse.json(
      { error: "Only fund officers can open voting" },
      { status: 403 }
    );
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid voting window" },
      { status: 400 }
    );
  }

  const { supabase, user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: pitchRow } = await supabase
    .from("pitches")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!pitchRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const pitch = pitchRow as Pitch;

  if (pitch.status !== "submitted" && pitch.status !== "scheduled") {
    return NextResponse.json(
      {
        error: `This pitch is ${pitch.status} — voting opens on submitted or scheduled pitches`,
      },
      { status: 400 }
    );
  }

  try {
    const result = await openPitchVote(supabase, {
      fund: ctx.fund,
      yearId: ctx.currentYear.id,
      pitch,
      actorId: user.id,
      windowHours: parsed.data.window_hours,
    });
    return NextResponse.json({ pitch: result.pitch });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Voting could not be opened";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
