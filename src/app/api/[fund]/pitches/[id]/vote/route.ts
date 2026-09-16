// POST /api/[fund]/pitches/[id]/vote — cast or change a ballot while the
// window is open (SPEC Section 12). One row per voter (upsert). The votes
// RLS enforces all of this too; the checks here exist to return clear 403s.
// Respects fund.settings.sector_can_vote_on_own_pitch (default true).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { inSector, isActiveVoter } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { Pitch } from "@/types/domain";

const bodySchema = z.object({
  choice: z.enum(["yes", "no"]),
  comment: z.string().trim().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Vote yes or no" },
      { status: 400 }
    );
  }

  if (!isActiveVoter(ctx)) {
    return NextResponse.json(
      {
        error: ctx.isAppAdmin
          ? "App admins are not students and do not vote"
          : ctx.isFacultyAdvisor && !ctx.membership
            ? "The faculty advisor does not vote"
            : "Only active members of the fund (not viewers or alumni) can vote",
      },
      { status: 403 }
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

  const now = new Date();
  const open =
    pitch.status === "voting" &&
    pitch.vote_opens_at !== null &&
    pitch.vote_closes_at !== null &&
    now >= new Date(pitch.vote_opens_at) &&
    now <= new Date(pitch.vote_closes_at);
  if (!open) {
    return NextResponse.json(
      {
        error:
          pitch.status === "voting"
            ? "The voting window has closed — the result will be posted shortly"
            : "Voting is not open on this pitch",
      },
      { status: 403 }
    );
  }

  // Fund setting: may the pitching sector vote on its own pitch? Default yes
  // (that is how the class runs today — SPEC Section 12 rules).
  const sectorCanVote = ctx.fund.settings?.sector_can_vote_on_own_pitch !== false;
  if (!sectorCanVote && inSector(ctx, pitch.sector_id)) {
    return NextResponse.json(
      {
        error:
          "This fund does not let members of the pitching sector vote on their own pitch",
      },
      { status: 403 }
    );
  }

  const { data: voteRow, error } = await supabase
    .from("votes")
    .upsert(
      {
        pitch_id: pitch.id,
        voter_id: user.id,
        choice: parsed.data.choice,
        comment: parsed.data.comment ?? null,
        cast_at: now.toISOString(),
      },
      { onConflict: "pitch_id,voter_id" }
    )
    .select("id, choice, comment, cast_at")
    .single();
  if (error || !voteRow) {
    return NextResponse.json(
      { error: error?.message ?? "Your vote could not be saved" },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: user.id,
    fundId: ctx.fund.id,
    action: "vote.cast",
    entity: "votes",
    entityId: pitch.id,
    after: { pitch_id: pitch.id, choice: parsed.data.choice },
  });

  return NextResponse.json({ vote: voteRow });
}
