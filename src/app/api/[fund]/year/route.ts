// POST /api/[fund]/year — academic year rollover (SPEC 17.2): current-year
// active memberships in BOTH funds become alumni, a new year becomes
// current. Roster managers only; service role because it spans both funds.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  confirm_label: z.string(), // must equal the next year's label, e.g. "2027-28"
});

function nextYearLabel(current: string): string | null {
  const m = current.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const startYear = Number(m[1]) + 1;
  const endYy = String((Number(m[2]) + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYy}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!can(ctx, "manage_roster")) {
    return NextResponse.json(
      { error: "Only roster managers can start a new academic year." },
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
    return NextResponse.json({ error: "Missing confirmation." }, { status: 400 });
  }

  const next = nextYearLabel(ctx.currentYear.label);
  if (!next) {
    return NextResponse.json(
      { error: `Cannot derive the next year from "${ctx.currentYear.label}".` },
      { status: 500 }
    );
  }
  if (parsed.data.confirm_label !== next) {
    return NextResponse.json(
      { error: `Type ${next} to confirm the rollover.` },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const startYear = Number(next.slice(0, 4));

  // 1. All active memberships in the current year -> alumni (both funds).
  const { error: alumniError, count } = await service
    .from("memberships")
    .update({ status: "alumni" }, { count: "exact" })
    .eq("academic_year_id", ctx.currentYear.id)
    .eq("status", "active");
  if (alumniError) {
    return NextResponse.json({ error: alumniError.message }, { status: 500 });
  }

  // 2. New year becomes current.
  const { error: unsetError } = await service
    .from("academic_years")
    .update({ is_current: false })
    .eq("id", ctx.currentYear.id);
  if (unsetError) {
    return NextResponse.json({ error: unsetError.message }, { status: 500 });
  }
  const { data: newYear, error: yearError } = await service
    .from("academic_years")
    .insert({
      label: next,
      starts_on: `${startYear}-08-01`,
      ends_on: `${startYear + 1}-07-31`,
      is_current: true,
    })
    .select()
    .single();
  if (yearError) {
    // Attempt to restore the current flag so the app is not left yearless.
    await service
      .from("academic_years")
      .update({ is_current: true })
      .eq("id", ctx.currentYear.id);
    return NextResponse.json({ error: yearError.message }, { status: 500 });
  }

  const userScoped = await createSupabaseServerClient();
  await logAudit(userScoped, {
    actorId: ctx.profile.id,
    fundId: null,
    action: "year.rollover",
    entity: "academic_years",
    entityId: newYear.id as string,
    before: { current: ctx.currentYear.label },
    after: { current: next, memberships_archived: count ?? 0 },
  });

  return NextResponse.json({
    new_year: newYear,
    memberships_archived: count ?? 0,
  });
}
