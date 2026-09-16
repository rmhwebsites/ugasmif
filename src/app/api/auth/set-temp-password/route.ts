// POST /api/auth/set-temp-password { userId } — officer sets a temporary
// password shown once (SPEC Section 7). Forces a change on next login via
// profiles.must_change_password; the member is notified without the
// password. Audit-logged.

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthState } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/emails/send";
import { logAudit } from "@/lib/audit";
import { actorMayResetTarget } from "@/lib/auth-admin";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ userId: z.uuid() });

// Unambiguous characters only (no 0/O, 1/l/I).
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generatePassword(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

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
    return NextResponse.json({ error: "userId required." }, { status: 400 });
  }

  const allowed = await actorMayResetTarget(
    profile,
    user.id,
    parsed.data.userId
  );
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "Only roster managers of this member's fund can set a temporary password.",
      },
      { status: 403 }
    );
  }

  const service = createServiceClient();
  const { data: target } = await service
    .from("profiles")
    .select("email, full_name")
    .eq("id", parsed.data.userId)
    .maybeSingle();
  if (!target) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const password = generatePassword();
  const { error: updateError } = await service.auth.admin.updateUserById(
    parsed.data.userId,
    { password }
  );
  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { error: flagError } = await service
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", parsed.data.userId);
  if (flagError) {
    return NextResponse.json(
      {
        error: `Password set, but flagging the account failed: ${flagError.message}`,
      },
      { status: 500 }
    );
  }

  // Notify the member — never include the password (SPEC Section 7).
  await sendEmail({
    to: [target.email],
    subject: "An officer reset your SMIF Hub password",
    heading: "Your password was reset",
    bodyLines: [
      `A SMIF officer set a temporary password on your account.`,
      "They will share it with you directly. You'll be asked to choose a new password the next time you sign in.",
      "If you didn't expect this, contact a SMIF officer.",
    ],
    ctaLabel: "Sign in",
    ctaPath: "/login",
  });

  const supabase = await createSupabaseServerClient();
  await logAudit(supabase, {
    actorId: user.id,
    fundId: null,
    action: "auth.set_temp_password",
    entity: "profiles",
    entityId: parsed.data.userId,
    after: { email: target.email },
  });

  // Shown once to the officer.
  return NextResponse.json({ password });
}
