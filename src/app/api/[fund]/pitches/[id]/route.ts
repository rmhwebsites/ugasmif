// PATCH /api/[fund]/pitches/[id] — edit pitch fields (the editor's autosave
// hits this every ~3s while dirty; unchanged payloads are no-ops so the audit
// log doesn't flood). DELETE — discard a draft (author) or any pitch
// (officer), removing its storage files best-effort first.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState, getFundContext } from "@/lib/fund";
import { isOfficer, leadsSector } from "@/lib/permissions";
import { logAudit } from "@/lib/audit";
import type { FundContext, Pitch, PitchFile } from "@/types/domain";

const numeric = z.number().finite().nullable().optional();

const patchSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200),
    pitch_type: z.enum(["bull", "bear", "single", "rebalance"]),
    action: z.enum(["buy", "add", "trim", "sell", "rebalance"]),
    sector_id: z.uuid(),
    holding_id: z.uuid().nullable(),
    symbol: z.string().trim().max(20).nullable(),
    instrument_name: z.string().trim().max(200).nullable(),
    instrument_type: z.string().trim().max(40).nullable(),
    cusip: z.string().trim().max(12).nullable(),
    thesis_md: z.string().max(100_000).nullable(),
    target_price: numeric,
    proposed_amount: numeric,
    proposed_weight_pct: numeric,
    funding_source: z.string().trim().max(200).nullable(),
    paired_pitch_id: z.uuid().nullable(),
  })
  .partial();

/** Who may edit content, mirroring the pitches update RLS. */
function canEdit(ctx: FundContext, pitch: Pitch, userId: string): boolean {
  if (isOfficer(ctx)) {
    return ["draft", "submitted", "scheduled"].includes(pitch.status);
  }
  if (leadsSector(ctx, pitch.sector_id)) {
    return ["draft", "submitted"].includes(pitch.status);
  }
  return pitch.author_id === userId && pitch.status === "draft";
}

async function loadPitch(
  slug: string,
  id: string
): Promise<
  | { error: NextResponse }
  | { ctx: FundContext; pitch: Pitch; userId: string }
> {
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = await getFundContext(slug);
  if (!ctx) return { error: notFound };
  if (!z.uuid().safeParse(id).success) return { error: notFound };

  const { supabase, user } = await getAuthState();
  if (!user) {
    return {
      error: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  const { data } = await supabase
    .from("pitches")
    .select("*")
    .eq("id", id)
    .eq("fund_id", ctx.fund.id)
    .maybeSingle();
  if (!data) return { error: notFound };
  return { ctx, pitch: data as Pitch, userId: user.id };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const loaded = await loadPitch(slug, id);
  if ("error" in loaded) return loaded.error;
  const { ctx, pitch, userId } = loaded;

  if (!canEdit(ctx, pitch, userId)) {
    return NextResponse.json(
      {
        error:
          "This pitch can no longer be edited — only the author (while draft), the sector leader (through submitted), or an officer (until voting opens) can change it.",
      },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid pitch fields" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const { supabase } = await getAuthState();

  if (input.sector_id !== undefined && input.sector_id !== pitch.sector_id) {
    const { data: sectorRow } = await supabase
      .from("sectors")
      .select("fund_id")
      .eq("id", input.sector_id)
      .maybeSingle();
    if (!sectorRow || (sectorRow as { fund_id: string }).fund_id !== ctx.fund.id) {
      return NextResponse.json(
        { error: "That sector is not part of this fund" },
        { status: 400 }
      );
    }
  }
  if (input.paired_pitch_id) {
    if (input.paired_pitch_id === pitch.id) {
      return NextResponse.json(
        { error: "A pitch cannot be paired with itself" },
        { status: 400 }
      );
    }
    const { data: paired } = await supabase
      .from("pitches")
      .select("fund_id")
      .eq("id", input.paired_pitch_id)
      .maybeSingle();
    if (!paired || (paired as { fund_id: string }).fund_id !== ctx.fund.id) {
      return NextResponse.json(
        { error: "The linked bear pitch is not part of this fund" },
        { status: 400 }
      );
    }
  }

  // Build the update, only touching columns that actually changed.
  const updates: Record<string, unknown> = {};
  const columns = [
    "title",
    "pitch_type",
    "action",
    "sector_id",
    "holding_id",
    "symbol",
    "instrument_name",
    "instrument_type",
    "thesis_md",
    "funding_source",
  ] as const;
  for (const col of columns) {
    if (input[col] !== undefined && input[col] !== pitch[col]) {
      updates[col] = input[col];
    }
  }
  const numericCols = ["target_price", "proposed_amount", "proposed_weight_pct"] as const;
  for (const col of numericCols) {
    if (input[col] === undefined) continue;
    const current = pitch[col] === null ? null : Number(pitch[col]);
    if (input[col] !== current) updates[col] = input[col];
  }

  const settings: Record<string, unknown> = {
    ...((pitch.settings as Record<string, unknown> | null) ?? {}),
  };
  let settingsChanged = false;
  if (input.paired_pitch_id !== undefined) {
    const next = input.paired_pitch_id ?? undefined;
    if (settings.paired_pitch_id !== next) {
      if (next === undefined) delete settings.paired_pitch_id;
      else settings.paired_pitch_id = next;
      settingsChanged = true;
    }
  }
  if (input.cusip !== undefined) {
    const next = input.cusip ?? undefined;
    if (settings.cusip !== next) {
      if (next === undefined) delete settings.cusip;
      else settings.cusip = next;
      settingsChanged = true;
    }
  }
  if (settingsChanged) updates.settings = settings;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ pitch, unchanged: true });
  }

  const { data: updated, error } = await supabase
    .from("pitches")
    .update(updates)
    .eq("id", pitch.id)
    .select("*")
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message ?? "The pitch could not be saved" },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: userId,
    fundId: ctx.fund.id,
    action: "pitch.update",
    entity: "pitches",
    entityId: pitch.id,
    before: Object.fromEntries(
      Object.keys(updates).map((k) => [k, pitch[k as keyof Pitch] ?? null])
    ),
    after: updates,
  });

  return NextResponse.json({ pitch: updated as Pitch });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ fund: string; id: string }> }
) {
  const { fund: slug, id } = await params;
  const loaded = await loadPitch(slug, id);
  if ("error" in loaded) return loaded.error;
  const { ctx, pitch, userId } = loaded;

  const allowed =
    (pitch.author_id === userId && pitch.status === "draft") || isOfficer(ctx);
  if (!allowed) {
    return NextResponse.json(
      { error: "Only the author (while draft) or an officer can delete a pitch" },
      { status: 403 }
    );
  }

  const { supabase } = await getAuthState();

  // Remove storage objects first (best-effort — RLS may block on closed
  // pitches; the DB rows cascade with the pitch either way).
  const { data: fileRows } = await supabase
    .from("pitch_files")
    .select("storage_path")
    .eq("pitch_id", pitch.id);
  const paths = ((fileRows as Pick<PitchFile, "storage_path">[] | null) ?? []).map(
    (f) => f.storage_path
  );
  if (paths.length > 0) {
    await supabase.storage.from("pitch-files").remove(paths);
  }

  const { error } = await supabase.from("pitches").delete().eq("id", pitch.id);
  if (error) {
    return NextResponse.json(
      { error: `The pitch could not be deleted: ${error.message}` },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: userId,
    fundId: ctx.fund.id,
    action: "pitch.delete",
    entity: "pitches",
    entityId: pitch.id,
    before: { title: pitch.title, status: pitch.status },
  });

  return NextResponse.json({ ok: true });
}
