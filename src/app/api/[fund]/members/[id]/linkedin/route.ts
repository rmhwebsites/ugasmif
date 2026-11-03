// PUT /api/[fund]/members/[id]/linkedin — a roster manager sets the LinkedIn
// link of someone who is or was on this fund's roster, for the alumni page.
// Most alumni never sign in again, so this is how their links get filled in.
// [id] is a membership id in this fund, as the member pages use.
//
// The rule (roster managers of this fund, people who have been on it) and
// the audit entry live in the SQL function set_member_linkedin (migration
// 0007); this route cleans up the link and gives clear errors.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { normalizeLinkedIn } from "@/lib/alumni";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ linkedin_url: z.string().max(500) });

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx || !z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "manage_roster")) {
    return NextResponse.json(
      { error: "Only the people who manage the roster can change a member's LinkedIn link." },
      { status: 403 }
    );
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Send the link as linkedin_url." }, { status: 400 });
  }
  const linkedin = normalizeLinkedIn(parsed.data.linkedin_url);
  if ("error" in linkedin) {
    return NextResponse.json({ error: linkedin.error }, { status: 400 });
  }

  const { supabase } = await getAuthState();
  const { data: membership } = await supabase
    .from("memberships")
    .select("user_id")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const { error } = await supabase.rpc("set_member_linkedin", {
    p_fund: ctx.fund.id,
    p_user: membership.user_id,
    p_url: linkedin.url ?? "",
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ linkedin_url: linkedin.url });
}
