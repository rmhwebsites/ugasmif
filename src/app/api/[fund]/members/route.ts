// POST /api/[fund]/members — add one member (SPEC 11.3, 17.1). Creates the
// auth user with the service role when the email is new, sends a branded
// invite, upserts the current-year membership. Roster managers only
// (president, VP, alumni relations, app admin — not the PM).

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/emails/send";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// The invite goes out through Resend carrying `properties.action_link`
// verbatim, so Supabase never renders its own template and the token_hash
// path handled by /auth/confirm is never used. action_link is
// `auth/v1/verify?...&redirect_to=...` and redirect_to falls back to the
// project Site URL when the option is omitted, which would drop the invited
// member on the app root instead of the set-password screen (SPEC 7, 11.1).
function inviteRedirectTo(): string | undefined {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/auth/set-password` : undefined;
}

const bodySchema = z.object({
  email: z.string().email().transform((e) => e.trim().toLowerCase()),
  full_name: z.string().trim().min(1).max(120),
  role: z.enum([
    "president",
    "vice_president",
    "portfolio_manager",
    "alumni_relations",
    "sector_leader",
    "analyst",
    "viewer",
  ]),
  sector_id: z.uuid().optional().nullable(),
  is_sector_leader: z.boolean().optional(),
  title_override: z.string().trim().max(80).optional().nullable(),
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
  if (!can(ctx, "manage_roster")) {
    return NextResponse.json(
      {
        error:
          "Only the president, vice president, alumni relations director, or an app admin can edit the roster.",
      },
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
  const body = parsed.data;

  const domain = body.email.split("@")[1] ?? "";
  if (!ctx.fund.allowed_email_domains.includes(domain)) {
    return NextResponse.json(
      {
        error: `${domain} is not an allowed email domain for ${ctx.fund.name}. Officers can add domains in fund settings.`,
      },
      { status: 400 }
    );
  }

  if (body.sector_id) {
    const supabase = await createSupabaseServerClient();
    const { data: sector } = await supabase
      .from("sectors")
      .select("id")
      .eq("id", body.sector_id)
      .eq("fund_id", ctx.fund.id)
      .maybeSingle();
    if (!sector) {
      return NextResponse.json(
        { error: "That sector is not in this fund." },
        { status: 400 }
      );
    }
  }

  const service = createServiceClient();

  // Find or create the auth user + profile.
  const { data: existingProfile } = await service
    .from("profiles")
    .select("id")
    .eq("email", body.email)
    .maybeSingle();

  let userId = existingProfile?.id as string | undefined;
  let invited = false;

  if (!userId) {
    const { data: created, error: createError } =
      await service.auth.admin.createUser({
        email: body.email,
        email_confirm: true,
        user_metadata: { full_name: body.full_name },
      });
    if (createError || !created.user) {
      return NextResponse.json(
        { error: createError?.message ?? "Could not create the account." },
        { status: 400 }
      );
    }
    userId = created.user.id;

    const redirectTo = inviteRedirectTo();
    const { data: linkData } = await service.auth.admin.generateLink({
      type: "invite",
      email: body.email,
      options: redirectTo ? { redirectTo } : undefined,
    });
    const actionLink = linkData?.properties?.action_link;
    if (actionLink) {
      await sendEmail({
        to: [body.email],
        subject: `Welcome to SMIF Hub — ${ctx.fund.name}`,
        heading: `Welcome to SMIF Hub, ${body.full_name.split(" ")[0]}`,
        bodyLines: [
          `You've been added to the ${ctx.fund.name} roster.`,
          "Click the button below to set your password and sign in.",
          "This link expires after 24 hours — ask an officer to resend it if it lapses.",
        ],
        ctaLabel: "Set your password",
        ctaPath: actionLink,
        fundSlug: ctx.fund.slug,
      });
      invited = true;
    }
  }

  // Upsert the membership for the current year.
  const { data: membership, error: memberError } = await service
    .from("memberships")
    .upsert(
      {
        user_id: userId,
        fund_id: ctx.fund.id,
        academic_year_id: ctx.currentYear.id,
        role: body.role,
        sector_id: body.sector_id ?? null,
        is_sector_leader: body.is_sector_leader ?? false,
        status: "active",
        title_override: body.title_override ?? null,
      },
      { onConflict: "user_id,fund_id,academic_year_id" }
    )
    .select()
    .single();

  if (memberError) {
    return NextResponse.json({ error: memberError.message }, { status: 400 });
  }

  const userScoped = await createSupabaseServerClient();
  await logAudit(userScoped, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "membership.create",
    entity: "memberships",
    entityId: membership.id as string,
    after: membership,
  });

  return NextResponse.json({ membership, invited });
}
