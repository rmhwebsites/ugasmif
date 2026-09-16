// POST /api/[fund]/updates/read — mark fund updates as read for the caller
// (SPEC 11.2 updates page, "unread badge"). Upserts update_reads rows for the
// signed-in user only; update_reads RLS is strictly per-user, so nobody can
// mark receipts for someone else. Ids that don't belong to this fund are
// ignored rather than erroring, so a stale tab never breaks the page.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";

const bodySchema = z.object({
  updateIds: z.array(z.uuid()).min(1, "Send at least one update id").max(500),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "view_fund")) {
    return NextResponse.json(
      { error: "You are not a member of this fund" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { supabase, user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Only mark updates that actually belong to this fund.
  const { data: validRows, error: lookupError } = await supabase
    .from("fund_updates")
    .select("id")
    .eq("fund_id", ctx.fund.id)
    .in("id", parsed.data.updateIds);
  if (lookupError) {
    return NextResponse.json({ error: lookupError.message }, { status: 400 });
  }
  const validIds = ((validRows as { id: string }[] | null) ?? []).map(
    (r) => r.id
  );
  if (validIds.length === 0) {
    return NextResponse.json({ marked: 0 });
  }

  const { error } = await supabase.from("update_reads").upsert(
    validIds.map((update_id) => ({ update_id, user_id: user.id })),
    { onConflict: "update_id,user_id", ignoreDuplicates: true }
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ marked: validIds.length });
}
