// POST /api/[fund]/sector-targets — set target/benchmark weights with an
// effective date (SPEC 11.3). Officers, or the strategy-team leader
// (Equity Strategies / Macro) per the permission matrix.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import type { Sector } from "@/types/domain";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  effective_on: z.string().date(),
  notes: z.string().max(1000).optional().nullable(),
  targets: z
    .array(
      z.object({
        sector_id: z.uuid(),
        target_weight_pct: z.number().min(0).max(100),
        benchmark_weight_pct: z.number().min(0).max(100).optional().nullable(),
      })
    )
    .min(1),
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
  const { data: sectorRows } = await supabase
    .from("sectors")
    .select("*")
    .eq("fund_id", ctx.fund.id);
  const sectors = new Map(
    ((sectorRows as Sector[]) ?? []).map((s) => [s.id, s])
  );

  // Permission: officer, or a strategy-team leader (checked via their own
  // sector — a Macro leader may set the whole fund's targets).
  const strategySector = [...sectors.values()].find(
    (s) =>
      s.is_strategy_team &&
      ctx.membership?.sector_id === s.id &&
      ctx.membership.is_sector_leader
  );
  const allowed = can(ctx, "set_sector_targets", {
    sectorId: strategySector?.id,
    isStrategySector: strategySector !== undefined,
  });
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "Only officers or the strategy team's leader can set sector targets.",
      },
      { status: 403 }
    );
  }

  for (const t of parsed.data.targets) {
    if (!sectors.has(t.sector_id)) {
      return NextResponse.json(
        { error: "One of the sectors is not in this fund." },
        { status: 400 }
      );
    }
  }

  const rows = parsed.data.targets.map((t) => ({
    fund_id: ctx.fund.id,
    sector_id: t.sector_id,
    target_weight_pct: t.target_weight_pct,
    benchmark_weight_pct: t.benchmark_weight_pct ?? null,
    effective_on: parsed.data.effective_on,
    set_by: ctx.profile.id,
    notes: parsed.data.notes ?? null,
  }));

  const { error } = await supabase
    .from("sector_targets")
    .upsert(rows, { onConflict: "sector_id,effective_on" });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "sector_targets.set",
    entity: "sector_targets",
    after: { effective_on: parsed.data.effective_on, count: rows.length },
  });

  return NextResponse.json({ saved: rows.length });
}
