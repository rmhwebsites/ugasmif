// POST /api/[fund]/marks — enter a single bond mark (SPEC 13.3).
// canExecute-gated, audit-logged.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { canExecute } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  holding_id: z.uuid(),
  clean_price: z.number().min(1).max(300),
  ytm: z.number().min(-5).max(50).optional().nullable(),
  duration: z.number().min(0).max(50).optional().nullable(),
  source: z.enum(["bloomberg", "broker", "finra_trace", "other"]),
  marked_at: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(1000).optional().nullable(),
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
  if (!canExecute(ctx)) {
    return NextResponse.json(
      { error: "Only the PM, faculty advisor, or an app admin can enter marks." },
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
  // The holding must belong to this fund.
  const { data: holding } = await supabase
    .from("holdings")
    .select("id, fund_id, name")
    .eq("id", parsed.data.holding_id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!holding) {
    return NextResponse.json(
      { error: "Holding not found in this fund." },
      { status: 404 }
    );
  }

  const { data, error } = await supabase
    .from("bond_marks")
    .insert({
      holding_id: parsed.data.holding_id,
      clean_price: parsed.data.clean_price,
      ytm: parsed.data.ytm ?? null,
      duration: parsed.data.duration ?? null,
      source: parsed.data.source,
      marked_by: ctx.profile.id,
      ...(parsed.data.marked_at ? { marked_at: parsed.data.marked_at } : {}),
      notes: parsed.data.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "mark.create",
    entity: "bond_marks",
    entityId: data.id as string,
    after: data,
  });

  return NextResponse.json({ mark: data });
}
