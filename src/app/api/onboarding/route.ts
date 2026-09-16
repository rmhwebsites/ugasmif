// POST /api/onboarding — saves the first-run details and marks the member
// onboarded. Everything runs through the user-scoped client: RLS allows a
// member to update their own profile row, and migration 0003 allows them to
// set sector_id on their own active membership (and nothing else).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  first_name: z.string().trim().min(1).max(60),
  last_name: z.string().trim().min(1).max(60),
  phone: z.string().trim().max(30).optional().nullable(),
  avatar_url: z.string().url().max(500).optional().nullable(),
  sectors: z
    .array(
      z.object({
        membership_id: z.uuid(),
        sector_id: z.uuid(),
      })
    )
    .max(4)
    .optional()
    .default([]),
});

export async function POST(request: NextRequest) {
  const { user, profile } = await getAuthState();
  if (!user || !profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
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
  const body = parsed.data;

  // The avatar must live in this user's own folder of the avatars bucket.
  if (body.avatar_url) {
    const expected = `/storage/v1/object/public/avatars/${user.id}/`;
    if (!body.avatar_url.includes(expected)) {
      return NextResponse.json(
        { error: "That photo URL is not yours." },
        { status: 400 }
      );
    }
  }

  const supabase = await createSupabaseServerClient();

  const fullName = `${body.first_name} ${body.last_name}`.trim();
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      first_name: body.first_name,
      last_name: body.last_name,
      full_name: fullName,
      phone: body.phone ?? null,
      ...(body.avatar_url ? { avatar_url: body.avatar_url } : {}),
      onboarded_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  // Sector choices, one per fund the member belongs to. Each update is scoped
  // to their own row; the database trigger rejects anything but sector_id.
  const sectorErrors: string[] = [];
  for (const s of body.sectors) {
    const { error } = await supabase
      .from("memberships")
      .update({ sector_id: s.sector_id })
      .eq("id", s.membership_id)
      .eq("user_id", user.id);
    if (error) sectorErrors.push(error.message);
  }

  await logAudit(supabase, {
    actorId: user.id,
    fundId: null,
    action: "profile.onboarded",
    entity: "profiles",
    entityId: user.id,
    after: {
      full_name: fullName,
      has_phone: Boolean(body.phone),
      has_avatar: Boolean(body.avatar_url),
      sectors_set: body.sectors.length,
    },
  });

  if (sectorErrors.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        warning: `Your details were saved, but the sector could not be set: ${sectorErrors[0]}`,
      },
      { status: 200 }
    );
  }

  return NextResponse.json({ ok: true });
}
