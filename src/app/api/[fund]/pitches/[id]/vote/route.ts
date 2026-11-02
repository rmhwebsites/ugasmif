// POST /api/[fund]/pitches/[id]/vote — cast or change a ballot while the
// window is open (SPEC Section 12). One row per voter (upsert). The votes
// RLS enforces all of this too; the checks here exist to return clear 403s.
// Respects fund.settings.sector_can_vote_on_own_pitch (default true).
//
// A ballot names one of the pitch's options (migration 0006), or abstains:
//   { option_id }            for an allocation or No
//   { choice: "abstain" }    counts toward turnout, for neither side
//   { choice: "yes" | "no" } still accepted from older pages: yes is the
//                            pitch as written, no is No

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { inSector, isActiveVoter } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { choiceForKind, orderOptions } from "@/lib/ballot";
import type { Pitch, VoteChoice, VoteOption } from "@/types/domain";

const bodySchema = z
  .object({
    option_id: z.uuid().optional(),
    choice: z.enum(["yes", "no", "abstain"]).optional(),
    comment: z.string().trim().max(2000).optional(),
  })
  .refine((b) => b.option_id !== undefined || b.choice !== undefined, {
    message: "Pick an option or abstain",
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
      { error: parsed.error.issues[0]?.message ?? "Pick an option or abstain" },
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

  // Which option the ballot is for. A pitch whose vote opened before ballot
  // options existed gets its defaults on this first touch.
  const { error: ensureError } = await supabase.rpc("ensure_ballot_options", {
    p_pitch_id: pitch.id,
  });
  if (ensureError) {
    return NextResponse.json(
      { error: `Your vote could not be saved: ${ensureError.message}` },
      { status: 500 }
    );
  }
  const { data: optionRows } = await supabase
    .from("pitch_vote_options")
    .select("*")
    .eq("pitch_id", pitch.id);
  const options = orderOptions((optionRows ?? []) as VoteOption[]);

  let choice: VoteChoice;
  let optionId: string | null = null;
  const ballot = parsed.data;
  if (ballot.choice === "abstain" && ballot.option_id === undefined) {
    choice = "abstain";
  } else {
    const option = ballot.option_id
      ? options.find((o) => o.id === ballot.option_id)
      : options.find((o) => o.kind === (ballot.choice === "yes" ? "approve" : "reject"));
    if (!option) {
      return NextResponse.json(
        {
          error:
            "That option was just taken off the ballot. Pick again from the updated list.",
        },
        { status: 409 }
      );
    }
    choice = choiceForKind(option.kind);
    optionId = option.id;
  }

  const { data: voteRow, error } = await supabase
    .from("votes")
    .upsert(
      {
        pitch_id: pitch.id,
        voter_id: user.id,
        choice,
        option_id: optionId,
        comment: ballot.comment ?? null,
        cast_at: now.toISOString(),
      },
      { onConflict: "pitch_id,voter_id" }
    )
    .select("id, choice, option_id, comment, cast_at")
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
    after: { pitch_id: pitch.id, choice, option_id: optionId },
  });

  return NextResponse.json({ vote: voteRow });
}
