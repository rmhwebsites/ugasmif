// PATCH/DELETE /api/[fund]/updates/[id] — edit or remove an update
// (author or officer per SPEC Section 9).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can, isOfficer } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { FundUpdate } from "@/types/domain";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body_md: z.string().trim().min(1).max(20_000).optional(),
  pinned: z.boolean().optional(),
});

async function loadAndAuthorize(slug: string, id: string) {
  const ctx = await getFundContext(slug);
  if (!ctx) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!can(ctx, "post_updates")) {
    return {
      error: NextResponse.json({ error: "Officers only." }, { status: 403 }),
    };
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("fund_updates")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  const update = data as FundUpdate | null;
  if (!update) {
    return {
      error: NextResponse.json({ error: "Update not found." }, { status: 404 }),
    };
  }
  if (update.author_id !== ctx.profile.id && !isOfficer(ctx) && !ctx.isAppAdmin) {
    return {
      error: NextResponse.json(
        { error: "Only the author or an officer can change this update." },
        { status: 403 }
      ),
    };
  }
  return { ctx, supabase, update };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const loaded = await loadAndAuthorize(slug, id);
  if ("error" in loaded) return loaded.error;
  const { ctx, supabase, update } = loaded;

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

  const { data, error } = await supabase
    .from("fund_updates")
    .update(parsed.data)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "update.edit",
    entity: "fund_updates",
    entityId: id,
    before: { title: update.title, pinned: update.pinned },
    after: parsed.data,
  });

  return NextResponse.json({ update: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const loaded = await loadAndAuthorize(slug, id);
  if ("error" in loaded) return loaded.error;
  const { ctx, supabase, update } = loaded;

  const { error } = await supabase.from("fund_updates").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "update.delete",
    entity: "fund_updates",
    entityId: id,
    before: { title: update.title },
  });

  return NextResponse.json({ ok: true });
}
