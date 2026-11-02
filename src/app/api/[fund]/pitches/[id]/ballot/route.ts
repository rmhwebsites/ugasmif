// PUT /api/[fund]/pitches/[id]/ballot — an officer (or the app admin) sets
// the options a pitch is voted on: the allocation as pitched, any
// alternatives the class proposed, and No (migration 0006).
//
// The body is the whole ballot in order. Options it leaves out are removed.
// Ballots cast for a removed option, or for an option whose amount changed,
// are cleared, and those members are asked to vote again; the response says
// how many. Rewording an option keeps its ballots. Once the vote closes the
// ballot is fixed (the database refuses too).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { MAX_BALLOT_OPTIONS, MAX_LABEL_LENGTH, orderOptions, planBallotEdit } from "@/lib/ballot";
import type { Pitch, VoteOption } from "@/types/domain";

const bodySchema = z.object({
  options: z
    .array(
      z.object({
        id: z.uuid().optional(),
        kind: z.enum(["approve", "reject"]),
        label: z.string().max(MAX_LABEL_LENGTH),
        amount: z.number().positive().max(1e12).nullable(),
      })
    )
    .min(2)
    .max(MAX_BALLOT_OPTIONS),
});

const CLOSED = new Set(["passed", "failed", "executed", "withdrawn"]);

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx || !z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "schedule_pitch")) {
    return NextResponse.json(
      { error: "Only fund officers can change a ballot" },
      { status: 403 }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "That ballot doesn't look right" },
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
  if (CLOSED.has(pitch.status)) {
    return NextResponse.json(
      { error: `This pitch is ${pitch.status}, so its ballot can no longer change` },
      { status: 400 }
    );
  }

  // A pitch that has never had a ballot gets the two defaults first, so the
  // edit always lands on a ballot with its No in place. The form showed those
  // same defaults without ids; they are matched up below.
  const { count: priorCount } = await supabase
    .from("pitch_vote_options")
    .select("id", { count: "exact", head: true })
    .eq("pitch_id", pitch.id);
  const fresh = (priorCount ?? 0) === 0;
  const { error: ensureError } = await supabase.rpc("ensure_ballot_options", {
    p_pitch_id: pitch.id,
  });
  if (ensureError) {
    return NextResponse.json({ error: ensureError.message }, { status: 400 });
  }

  const [{ data: optionRows, error: optionsError }, { data: voteRows }] = await Promise.all([
    supabase.from("pitch_vote_options").select("*").eq("pitch_id", pitch.id),
    supabase.from("votes").select("option_id").eq("pitch_id", pitch.id),
  ]);
  if (optionsError) {
    return NextResponse.json({ error: optionsError.message }, { status: 400 });
  }
  const before = orderOptions((optionRows ?? []) as VoteOption[]);
  const ballots = new Map<string, number>();
  for (const v of (voteRows ?? []) as { option_id: string | null }[]) {
    if (v.option_id) ballots.set(v.option_id, (ballots.get(v.option_id) ?? 0) + 1);
  }

  let draft = parsed.data.options;
  if (fresh) {
    // The first yes and the No on the form are the defaults just created.
    const firstYes = before.find((o) => o.kind === "approve");
    const theNo = before.find((o) => o.kind === "reject");
    let yesTaken = false;
    draft = draft.map((d) => {
      if (d.id !== undefined) return d;
      if (d.kind === "reject" && theNo) return { ...d, id: theNo.id };
      if (d.kind === "approve" && firstYes && !yesTaken) {
        yesTaken = true;
        return { ...d, id: firstYes.id };
      }
      return d;
    });
  }

  const result = planBallotEdit(
    before.map((o) => ({ ...o, amount: o.amount === null ? null : Number(o.amount), ballots: ballots.get(o.id) ?? 0 })),
    draft
  );
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  const { plan } = result;

  if (plan.deletes.length > 0) {
    const { error } = await supabase.from("pitch_vote_options").delete().in("id", plan.deletes);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  for (const u of plan.updates) {
    const { error } = await supabase
      .from("pitch_vote_options")
      .update({ label: u.label, amount: u.amount, sort_order: u.sort_order })
      .eq("id", u.id)
      .eq("pitch_id", pitch.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (plan.inserts.length > 0) {
    const { error } = await supabase
      .from("pitch_vote_options")
      .insert(plan.inserts.map((o) => ({ ...o, pitch_id: pitch.id, created_by: user.id })));
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const { data: afterRows } = await supabase
    .from("pitch_vote_options")
    .select("*")
    .eq("pitch_id", pitch.id);
  const after = orderOptions((afterRows ?? []) as VoteOption[]);

  const changed = plan.inserts.length + plan.updates.length + plan.deletes.length > 0;
  if (changed) {
    const brief = (o: VoteOption) => ({ label: o.label, amount: o.amount === null ? null : Number(o.amount) });
    await logAudit(supabase, {
      actorId: user.id,
      fundId: ctx.fund.id,
      action: "pitch.ballot",
      entity: "pitches",
      entityId: pitch.id,
      before: { options: before.map(brief) },
      after: { options: after.map(brief), ballots_cleared: plan.cleared },
    });
  }

  return NextResponse.json({ options: after, cleared: plan.cleared });
}
