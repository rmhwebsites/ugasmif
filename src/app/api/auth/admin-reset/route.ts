// POST /api/auth/admin-reset { userId } — officer-triggered recovery link
// (SPEC Section 7). The link is emailed straight to the member, so the
// officer never sees it. Roster managers of a fund shared with the target,
// or an app admin. Audit-logged.

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

// Resend sends `properties.action_link` verbatim, so redirect_to has to be set
// here: omitted, Supabase's verify endpoint falls back to the project Site URL
// and the member never reaches the reset screen (SPEC 7, 11.1).
function recoveryRedirectTo(): string | undefined {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/auth/reset` : undefined;
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
      { error: "Only roster managers of this member's fund can send resets." },
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

  const redirectTo = recoveryRedirectTo();
  const { data: linkData, error: linkError } =
    await service.auth.admin.generateLink({
      type: "recovery",
      email: target.email,
      options: redirectTo ? { redirectTo } : undefined,
    });
  if (linkError || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: linkError?.message ?? "Could not generate the link." },
      { status: 500 }
    );
  }

  await sendEmail({
    to: [target.email],
    subject: "Reset your SMIF Hub password",
    heading: `Password reset for ${target.full_name.split(" ")[0]}`,
    bodyLines: [
      "An officer sent you this password reset link.",
      "Click the button below to choose a new password. The link expires after 24 hours.",
    ],
    ctaLabel: "Reset password",
    ctaPath: linkData.properties.action_link,
  });

  const supabase = await createSupabaseServerClient();
  await logAudit(supabase, {
    actorId: user.id,
    fundId: null,
    action: "auth.admin_reset",
    entity: "profiles",
    entityId: parsed.data.userId,
    after: { email: target.email },
  });

  return NextResponse.json({ sent: true });
}
