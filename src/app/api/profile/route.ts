// PATCH /api/profile — a signed-in user edits their own profiles row:
// display name, avatar URL, and email mute preferences (SPEC 11.2 profile
// page). RLS restricts the update to the caller's own row (global flags are
// blocked by the protect_profile_flags trigger). Audit-logged as
// 'profile.update'.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/fund";
import { logAudit } from "@/lib/audit";
import type { Profile } from "@/types/domain";

const bodySchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(1, "Your name can't be empty")
      .max(120, "Keep your name under 120 characters")
      .optional(),
    // Plain text field (no upload) — empty string clears the avatar.
    avatar_url: z
      .union([z.literal(""), z.url("Avatar must be a full http(s) URL").max(500)])
      .optional(),
    email_prefs: z
      .object({
        mute_updates: z.boolean().optional(),
        mute_reminders: z.boolean().optional(),
      })
      .optional(),
  })
  .refine(
    (b) =>
      b.full_name !== undefined ||
      b.avatar_url !== undefined ||
      b.email_prefs !== undefined,
    { message: "Nothing to update" }
  );

export async function PATCH(request: NextRequest) {
  const { supabase, user, profile } = await getAuthState();
  if (!user || !profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid profile update" },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.full_name !== undefined) {
    updates.full_name = parsed.data.full_name;
  }
  if (parsed.data.avatar_url !== undefined) {
    updates.avatar_url =
      parsed.data.avatar_url === "" ? null : parsed.data.avatar_url;
  }
  if (parsed.data.email_prefs !== undefined) {
    // Merge over the stored prefs so a partial payload never wipes a flag.
    updates.email_prefs = {
      ...(profile.email_prefs ?? {}),
      ...parsed.data.email_prefs,
    };
  }

  const { data: updated, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", user.id)
    .select("id, email, full_name, avatar_url, email_prefs")
    .single();
  if (error || !updated) {
    return NextResponse.json(
      { error: error?.message ?? "Your profile could not be saved" },
      { status: 400 }
    );
  }

  await logAudit(supabase, {
    actorId: user.id,
    fundId: null,
    action: "profile.update",
    entity: "profiles",
    entityId: user.id,
    before: {
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      email_prefs: profile.email_prefs ?? {},
    },
    after: updates,
  });

  return NextResponse.json({ profile: updated as Partial<Profile> });
}
