// PATCH /api/[fund]/settings — vote threshold, quorum, window, benchmark,
// email domains, meeting day, and jsonb settings (SPEC 11.3). Officer-gated.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { isOfficer } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  vote_pass_threshold_pct: z.number().min(1).max(100).optional(),
  vote_quorum_pct: z.number().min(1).max(100).optional().nullable(),
  vote_default_window_hours: z.number().int().min(1).max(336).optional(),
  benchmark_symbol: z.string().trim().min(1).max(12).optional(),
  benchmark_name: z.string().trim().min(1).max(80).optional(),
  allowed_email_domains: z
    .array(z.string().trim().min(3).max(80))
    .min(1)
    .optional(),
  meeting_day: z.number().int().min(0).max(6).optional().nullable(),
  settings: z
    .object({
      sector_can_vote_on_own_pitch: z.boolean().optional(),
      alumni_can_view_current: z.boolean().optional(),
      auto_open_votes: z.boolean().optional(),
      stale_mark_days: z.number().int().min(1).max(60).optional(),
      reply_to_email: z.string().email().optional().or(z.literal("")),
    })
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isOfficer(ctx)) {
    return NextResponse.json({ error: "Officers only." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }

  const { settings: settingsPatch, ...columns } = parsed.data;
  const update: Record<string, unknown> = { ...columns };
  if (settingsPatch) {
    update.settings = { ...ctx.fund.settings, ...settingsPatch };
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("funds")
    .update(update)
    .eq("id", ctx.fund.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "fund.settings",
    entity: "funds",
    entityId: ctx.fund.id,
    before: {
      vote_pass_threshold_pct: ctx.fund.vote_pass_threshold_pct,
      vote_quorum_pct: ctx.fund.vote_quorum_pct,
      vote_default_window_hours: ctx.fund.vote_default_window_hours,
      benchmark_symbol: ctx.fund.benchmark_symbol,
      allowed_email_domains: ctx.fund.allowed_email_domains,
      meeting_day: ctx.fund.meeting_day,
      settings: ctx.fund.settings,
    },
    after: update,
  });

  return NextResponse.json({ fund: data });
}
