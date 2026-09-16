// POST /api/[fund]/pitches/[id]/remind — officer button: email eligible
// members who have not voted yet (SPEC Section 12). Reminders are
// non-essential, so members who muted reminders are skipped. The officer's
// RLS grants read every ballot, which is what makes the non-voter diff
// possible here.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import { sendEmail } from "@/lib/emails/send";
import { formatDateTime } from "@/lib/format";
import type { Pitch } from "@/types/domain";

interface EligibleRow {
  user_id: string;
  profiles: {
    email: string | null;
    email_prefs: { mute_reminders?: boolean } | null;
  } | null;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "schedule_pitch")) {
    return NextResponse.json(
      { error: "Only fund officers can send vote reminders" },
      { status: 403 }
    );
  }
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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

  if (pitch.status !== "voting") {
    return NextResponse.json(
      { error: `This pitch is ${pitch.status} — reminders go out while voting is open` },
      { status: 400 }
    );
  }

  const [votesRes, membersRes] = await Promise.all([
    supabase.from("votes").select("voter_id").eq("pitch_id", pitch.id),
    supabase
      .from("memberships")
      .select("user_id, profiles(email, email_prefs)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", ctx.currentYear.id)
      .eq("status", "active")
      .neq("role", "viewer"),
  ]);

  const voted = new Set(
    ((votesRes.data as { voter_id: string }[] | null) ?? []).map((v) => v.voter_id)
  );
  const to: string[] = [];
  for (const row of (membersRes.data as unknown as EligibleRow[] | null) ?? []) {
    if (voted.has(row.user_id)) continue;
    const profile = row.profiles;
    if (!profile?.email) continue;
    if (profile.email_prefs?.mute_reminders === true) continue; // non-essential
    to.push(profile.email);
  }

  if (to.length > 0) {
    await sendEmail({
      to,
      subject: `Vote reminder: ${pitch.title} closes ${formatDateTime(pitch.vote_closes_at)} ET`,
      heading: "You have not voted yet",
      bodyLines: [
        `Voting on "${pitch.title}" closes ${formatDateTime(pitch.vote_closes_at)} ET.`,
        "Your vote counts toward quorum. Casting it takes under a minute.",
      ],
      ctaLabel: "Cast your vote",
      ctaPath: `/${ctx.fund.slug}/pitches/${pitch.id}`,
      fundSlug: ctx.fund.slug,
      replyTo: ctx.fund.settings?.reply_to_email,
    });
  }

  await logAudit(supabase, {
    actorId: user.id,
    fundId: ctx.fund.id,
    action: "pitch.remind",
    entity: "pitches",
    entityId: pitch.id,
    after: { reminded: to.length },
  });

  return NextResponse.json({ reminded: to.length });
}
