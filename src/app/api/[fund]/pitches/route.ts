// POST /api/[fund]/pitches — create a draft pitch (SPEC Section 12).
// Any active member may draft for their own sector; officers and app admins
// for any sector. Always starts in 'draft' with the caller as author (the
// pitches insert RLS enforces the same).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { Pitch, Sector } from "@/types/domain";

const numeric = z.number().finite().nullable().optional();

const pitchBodySchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  pitch_type: z.enum(["bull", "bear", "single", "rebalance"]),
  action: z.enum(["buy", "add", "trim", "sell", "rebalance"]),
  sector_id: z.uuid("Pick a sector"),
  holding_id: z.uuid().nullable().optional(),
  symbol: z.string().trim().max(20).nullable().optional(),
  instrument_name: z.string().trim().max(200).nullable().optional(),
  instrument_type: z.string().trim().max(40).nullable().optional(),
  cusip: z.string().trim().max(12).nullable().optional(),
  thesis_md: z.string().max(100_000).nullable().optional(),
  target_price: numeric,
  proposed_amount: numeric,
  proposed_weight_pct: numeric,
  funding_source: z.string().trim().max(200).nullable().optional(),
  paired_pitch_id: z.uuid().nullable().optional(),
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

  const body = await request.json().catch(() => null);
  const parsed = pitchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid pitch" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  if (!can(ctx, "draft_pitch", { sectorId: input.sector_id })) {
    return NextResponse.json(
      {
        error:
          "You can only draft pitches for your own sector. Officers can pitch for any sector.",
      },
      { status: 403 }
    );
  }

  const { supabase, user } = await getAuthState();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // The sector must belong to this fund.
  const { data: sectorRow } = await supabase
    .from("sectors")
    .select("id, fund_id")
    .eq("id", input.sector_id)
    .maybeSingle();
  const sector = sectorRow as Pick<Sector, "id" | "fund_id"> | null;
  if (!sector || sector.fund_id !== ctx.fund.id) {
    return NextResponse.json(
      { error: "That sector is not part of this fund" },
      { status: 400 }
    );
  }

  // A paired bear pitch must be one of this fund's pitches.
  if (input.paired_pitch_id) {
    const { data: paired } = await supabase
      .from("pitches")
      .select("id, fund_id")
      .eq("id", input.paired_pitch_id)
      .maybeSingle();
    if (!paired || (paired as { fund_id: string }).fund_id !== ctx.fund.id) {
      return NextResponse.json(
        { error: "The linked bear pitch is not part of this fund" },
        { status: 400 }
      );
    }
  }

  const settings: Record<string, string> = {};
  if (input.paired_pitch_id) settings.paired_pitch_id = input.paired_pitch_id;
  if (input.cusip) settings.cusip = input.cusip;

  const { data, error } = await supabase
    .from("pitches")
    .insert({
      fund_id: ctx.fund.id,
      sector_id: input.sector_id,
      author_id: user.id,
      title: input.title,
      pitch_type: input.pitch_type,
      action: input.action,
      holding_id: input.holding_id ?? null,
      symbol: input.symbol ?? null,
      instrument_name: input.instrument_name ?? null,
      instrument_type: input.instrument_type ?? null,
      thesis_md: input.thesis_md ?? null,
      target_price: input.target_price ?? null,
      proposed_amount: input.proposed_amount ?? null,
      proposed_weight_pct: input.proposed_weight_pct ?? null,
      funding_source: input.funding_source ?? null,
      settings,
      status: "draft",
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "The draft could not be created" },
      { status: 400 }
    );
  }
  const pitch = data as Pitch;

  await logAudit(supabase, {
    actorId: user.id,
    fundId: ctx.fund.id,
    action: "pitch.create",
    entity: "pitches",
    entityId: pitch.id,
    after: { title: pitch.title, sector_id: pitch.sector_id, action: pitch.action },
  });

  return NextResponse.json({ pitch }, { status: 201 });
}
