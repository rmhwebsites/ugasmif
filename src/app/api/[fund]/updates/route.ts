// POST /api/[fund]/updates — post an update (officers, advisor, admin).
// Optional member email per SPEC Section 16.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendToFund } from "@/lib/emails/send";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200),
  body_md: z.string().trim().min(1).max(20_000),
  pinned: z.boolean().optional(),
  email_members: z.boolean().optional(),
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
  if (!can(ctx, "post_updates")) {
    return NextResponse.json(
      { error: "Officers, the faculty advisor, or an app admin can post updates." },
      { status: 403 }
    );
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

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("fund_updates")
    .insert({
      fund_id: ctx.fund.id,
      author_id: ctx.profile.id,
      title: parsed.data.title,
      body_md: parsed.data.body_md,
      pinned: parsed.data.pinned ?? false,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "update.post",
    entity: "fund_updates",
    entityId: data.id as string,
    after: { title: parsed.data.title, pinned: parsed.data.pinned ?? false },
  });

  if (parsed.data.email_members) {
    await sendToFund(supabase, ctx.fund.id, {
      subject: `${ctx.fund.name}: ${parsed.data.title}`,
      heading: parsed.data.title,
      bodyLines: [
        parsed.data.body_md.slice(0, 400) +
          (parsed.data.body_md.length > 400 ? "…" : ""),
        `Posted by ${ctx.profile.full_name}.`,
      ],
      ctaLabel: "Read in SMIF Hub",
      ctaPath: `/${ctx.fund.slug}/updates`,
      essential: false,
    });
  }

  return NextResponse.json({ update: data });
}
