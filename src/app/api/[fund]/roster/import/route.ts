// POST /api/[fund]/roster/import — CSV roster import with preview + commit
// (SPEC 17.1). Format: email,full_name,fund,role,sector,is_sector_leader,
// title_override. Service role creates users; roster managers only.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { parseCsv } from "@/lib/csv";
import { sendEmail } from "@/lib/emails/send";
import { logAudit } from "@/lib/audit";
import type { Fund, Sector } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Resend sends `properties.action_link` verbatim, so redirect_to has to be set
// here: omitted, Supabase's verify endpoint falls back to the project Site URL
// and the invited member never reaches the set-password screen (SPEC 7, 11.1).
function inviteRedirectTo(): string | undefined {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/auth/set-password` : undefined;
}

const bodySchema = z.object({
  csv: z.string().min(1).max(1_000_000),
  commit: z.boolean().default(false),
  file_name: z.string().max(200).optional(),
});

const ROLES = new Set([
  "president",
  "vice_president",
  "portfolio_manager",
  "alumni_relations",
  "sector_leader",
  "analyst",
  "viewer",
]);

interface ParsedRow {
  row: number;
  email: string;
  full_name: string;
  fundSlug: string;
  role: string;
  sectorId: string | null;
  isLeader: boolean;
  titleOverride: string | null;
  action: "create" | "update";
  error?: string;
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
      { error: "Only roster managers can import the roster." },
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
    return NextResponse.json({ error: "Provide the CSV text." }, { status: 400 });
  }

  const service = createServiceClient();

  // Both funds are importable from either fund's admin (a row names its fund).
  const { data: fundRows } = await service.from("funds").select("*");
  // Keyed by plain string: CSV rows carry whatever the officer typed.
  const fundsBySlug = new Map<string, Fund>(
    ((fundRows as Fund[]) ?? []).map((f) => [f.slug as string, f])
  );
  const { data: sectorRows } = await service.from("sectors").select("*");
  const sectors = (sectorRows as Sector[]) ?? [];

  const rows = parseCsv(parsed.data.csv);
  if (rows.length < 2) {
    return NextResponse.json(
      { error: "The CSV needs a header row and at least one data row." },
      { status: 400 }
    );
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  for (const required of ["email", "full_name", "fund", "role"]) {
    if (col(required) === -1) {
      return NextResponse.json(
        { error: `Header must include ${required}.` },
        { status: 400 }
      );
    }
  }

  const { data: profileRows } = await service
    .from("profiles")
    .select("id, email");
  const profilesByEmail = new Map(
    ((profileRows as { id: string; email: string }[]) ?? []).map((p) => [
      p.email.toLowerCase(),
      p.id,
    ])
  );

  const parsedRows: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const email = (cells[col("email")] ?? "").trim().toLowerCase();
    const fullName = (cells[col("full_name")] ?? "").trim();
    const fundSlug = (cells[col("fund")] ?? "").trim().toLowerCase();
    const role = (cells[col("role")] ?? "").trim().toLowerCase();
    const sectorName =
      col("sector") >= 0 ? (cells[col("sector")] ?? "").trim() : "";
    const isLeader =
      col("is_sector_leader") >= 0
        ? ["true", "yes", "1"].includes(
            (cells[col("is_sector_leader")] ?? "").trim().toLowerCase()
          )
        : false;
    const titleOverride =
      col("title_override") >= 0
        ? (cells[col("title_override")] ?? "").trim() || null
        : null;

    const entry: ParsedRow = {
      row: i + 1,
      email,
      full_name: fullName,
      fundSlug,
      role,
      sectorId: null,
      isLeader,
      titleOverride,
      action: profilesByEmail.has(email) ? "update" : "create",
    };

    const fund = fundsBySlug.get(entry.fundSlug);
    if (!email.includes("@")) entry.error = "Bad email";
    else if (!fullName) entry.error = "Missing full_name";
    else if (!fund) entry.error = `fund must be athena or arch, got "${fundSlug}"`;
    else if (!ROLES.has(role)) entry.error = `Unknown role "${role}"`;
    else {
      const domain = email.split("@")[1] ?? "";
      if (!fund.allowed_email_domains.includes(domain)) {
        entry.error = `${domain} is not an allowed domain for ${fund.name}`;
      } else if (sectorName) {
        const sector = sectors.find(
          (s) =>
            s.fund_id === fund.id &&
            s.name.toLowerCase() === sectorName.toLowerCase()
        );
        if (!sector) {
          entry.error = `Unknown sector "${sectorName}" in ${fund.name}`;
        } else {
          entry.sectorId = sector.id;
        }
      }
    }
    parsedRows.push(entry);
  }

  const valid = parsedRows.filter((r) => !r.error);
  const errors = parsedRows.filter((r) => r.error);

  if (!parsed.data.commit) {
    return NextResponse.json({
      preview: true,
      total: parsedRows.length,
      creates: valid.filter((r) => r.action === "create").length,
      updates: valid.filter((r) => r.action === "update").length,
      rows: parsedRows.map((r) => ({
        row: r.row,
        email: r.email,
        full_name: r.full_name,
        fund: r.fundSlug,
        role: r.role,
        action: r.error ? "error" : r.action,
        error: r.error ?? null,
      })),
    });
  }

  // Commit. One auth user per unique new email; memberships per row.
  let created = 0;
  let updated = 0;
  let failed = errors.length;
  const commitErrors: { row: number; message: string }[] = errors.map((r) => ({
    row: r.row,
    message: r.error!,
  }));

  for (const r of valid) {
    try {
      let userId = profilesByEmail.get(r.email);
      if (!userId) {
        const { data: createdUser, error: createError } =
          await service.auth.admin.createUser({
            email: r.email,
            email_confirm: true,
            user_metadata: { full_name: r.full_name },
          });
        if (createError || !createdUser.user) {
          throw new Error(createError?.message ?? "createUser failed");
        }
        userId = createdUser.user.id;
        profilesByEmail.set(r.email, userId);

        const redirectTo = inviteRedirectTo();
        const { data: linkData } = await service.auth.admin.generateLink({
          type: "invite",
          email: r.email,
          options: redirectTo ? { redirectTo } : undefined,
        });
        const actionLink = linkData?.properties?.action_link;
        if (actionLink) {
          await sendEmail({
            to: [r.email],
            subject: "Welcome to SMIF Hub",
            heading: `Welcome to SMIF Hub, ${r.full_name.split(" ")[0]}`,
            bodyLines: [
              "You've been added to the SMIF roster.",
              "Click the button below to set your password and sign in.",
            ],
            ctaLabel: "Set your password",
            ctaPath: actionLink,
          });
        }
        created++;
      } else {
        updated++;
      }

      const fund = fundsBySlug.get(r.fundSlug)!;
      const { error: memberError } = await service.from("memberships").upsert(
        {
          user_id: userId,
          fund_id: fund.id,
          academic_year_id: ctx.currentYear.id,
          role: r.role,
          sector_id: r.sectorId,
          is_sector_leader: r.isLeader,
          status: "active",
          title_override: r.titleOverride,
        },
        { onConflict: "user_id,fund_id,academic_year_id" }
      );
      if (memberError) throw new Error(memberError.message);
    } catch (err) {
      failed++;
      commitErrors.push({
        row: r.row,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  await service.from("roster_imports").insert({
    fund_id: ctx.fund.id,
    academic_year_id: ctx.currentYear.id,
    imported_by: ctx.profile.id,
    file_name: parsed.data.file_name ?? null,
    rows_total: parsedRows.length,
    rows_created: created,
    rows_updated: updated,
    rows_failed: failed,
    errors: commitErrors,
  });

  const userScoped = await createSupabaseServerClient();
  await logAudit(userScoped, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "roster.import",
    entity: "roster_imports",
    after: { total: parsedRows.length, created, updated, failed },
  });

  // Summary email to the importing officer (SPEC Section 16).
  await sendEmail({
    to: [ctx.profile.email],
    subject: "Roster import finished",
    heading: "Roster import finished",
    bodyLines: [
      `${parsedRows.length} rows processed: ${created} accounts created, ${updated} existing members updated, ${failed} failed.`,
      ...(commitErrors.length > 0
        ? [`First errors: ${commitErrors.slice(0, 5).map((e) => `row ${e.row}: ${e.message}`).join("; ")}`]
        : []),
    ],
    ctaLabel: "Open the roster",
    ctaPath: `/${ctx.fund.slug}/admin/members`,
    fundSlug: ctx.fund.slug,
  });

  return NextResponse.json({
    committed: true,
    total: parsedRows.length,
    created,
    updated,
    failed,
    errors: commitErrors,
  });
}
