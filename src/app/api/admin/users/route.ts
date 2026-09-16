// POST /api/admin/users — grant or revoke global flags (SPEC 11.3 /admin).
// App admins only; they cannot remove their own admin flag (break-glass
// safety). Service role because RLS blocks these columns.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  userId: z.uuid(),
  is_app_admin: z.boolean().optional(),
  is_faculty_advisor: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const { user, profile } = await getAuthState();
  if (!user || !profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!profile.is_app_admin) {
    return NextResponse.json(
      { error: "Only app admins can change global flags." },
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

  const { userId, ...flags } = parsed.data;
  if (Object.keys(flags).length === 0) {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }
  if (userId === user.id && flags.is_app_admin === false) {
    return NextResponse.json(
      {
        error:
          "You can't remove your own app admin flag. Ask another app admin.",
      },
      { status: 400 }
    );
  }

  const service = createServiceClient();
  const { data: before } = await service
    .from("profiles")
    .select("id, email, is_app_admin, is_faculty_advisor")
    .eq("id", userId)
    .maybeSingle();
  if (!before) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const { data, error } = await service
    .from("profiles")
    .update(flags)
    .eq("id", userId)
    .select("id, email, is_app_admin, is_faculty_advisor")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  await logAudit(supabase, {
    actorId: user.id,
    fundId: null,
    action: "admin.grant",
    entity: "profiles",
    entityId: userId,
    before,
    after: data,
  });

  return NextResponse.json({ profile: data });
}
