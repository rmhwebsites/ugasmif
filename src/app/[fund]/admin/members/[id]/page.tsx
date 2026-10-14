// /[fund]/admin/members/[id] — one member: their role and sector this year,
// sign-in help (resend the invite, reset link, temporary password), every
// membership across funds and years, and a link to their audit history
// (SPEC Section 7). [id] is the membership id the roster and Team link; an
// account id from older links resolves too.

import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { getFundContext } from "@/lib/fund";
import { can, roleLabel } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PasswordTools } from "@/components/admin/PasswordTools";
import { MembershipControls } from "@/components/admin/MemberEditor";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { LinkButton, PageHeader } from "@/components/ui/PageHeader";
import { SectorLink } from "@/components/ui/SectorLink";
import { formatDate } from "@/lib/format";
import type {
  AcademicYear,
  Fund,
  Membership,
  Profile,
  Sector,
} from "@/types/domain";

type MembershipRow = Membership & {
  funds: Pick<Fund, "name" | "slug"> | null;
  academic_years: Pick<AcademicYear, "label"> | null;
  sectors: Pick<Sector, "name" | "slug"> | null;
};

/** The member behind a route id, read once for the title and the page. */
const loadMember = cache(async (fundId: string, id: string) => {
  const supabase = await createSupabaseServerClient();
  const { data: routed } = await supabase
    .from("memberships")
    .select("id, user_id")
    .eq("id", id)
    .eq("fund_id", fundId)
    .maybeSingle();
  const userId = (routed?.user_id as string | undefined) ?? id;

  const [profileRes, membershipsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase
      .from("memberships")
      .select("*, funds(name, slug), academic_years(label), sectors(name, slug)")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);
  return {
    routedMembershipId: (routed?.id as string | undefined) ?? null,
    profile: profileRes.data as Profile | null,
    memberships: (membershipsRes.data as MembershipRow[]) ?? [],
  };
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}): Promise<Metadata> {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx || !can(ctx, "manage_roster")) return {};
  const { profile } = await loadMember(ctx.fund.id, id);
  return profile ? { title: profile.full_name } : {};
}

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!can(ctx, "manage_roster")) notFound();

  const { routedMembershipId, profile, memberships } = await loadMember(
    ctx.fund.id,
    id
  );
  if (!profile) notFound();

  const supabase = await createSupabaseServerClient();
  const { data: sectorRows } = await supabase
    .from("sectors")
    .select("id, name")
    .eq("fund_id", ctx.fund.id)
    .eq("is_active", true)
    .order("sort_order");
  const sectors = (sectorRows as Pick<Sector, "id" | "name">[]) ?? [];

  // The membership to edit here: the one the link named, else this year's
  // in this fund.
  const inFund = memberships.filter((m) => m.fund_id === ctx.fund.id);
  const editable =
    inFund.find((m) => m.id === routedMembershipId) ??
    inFund.find((m) => m.academic_year_id === ctx.currentYear.id) ??
    null;
  const signedUp = profile.onboarded_at !== null;

  // Their history: this fund's memberships and the account itself, which
  // is where password resets are logged.
  const historyIds = [...inFund.map((m) => m.id).slice(0, 4), profile.id];
  const historyHref = `/${ctx.fund.slug}/admin/audit?entity_id=${historyIds.join(",")}`;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="space-y-2">
        <PageHeader
          back={{ href: `/${ctx.fund.slug}/admin/members`, label: "Members" }}
          title={profile.full_name}
          description={profile.email}
          actions={
            can(ctx, "view_audit_log") ? (
              <LinkButton href={historyHref} variant="secondary">
                <History className="h-4 w-4" aria-hidden="true" />
                History
              </LinkButton>
            ) : undefined
          }
        />
        <div className="flex flex-wrap gap-2">
          {profile.is_app_admin && <Badge tone="accent">app admin</Badge>}
          {profile.is_faculty_advisor && (
            <Badge tone="info">faculty advisor</Badge>
          )}
          {!signedUp && <Badge tone="warn">not signed up yet</Badge>}
          {profile.must_change_password && (
            <Badge tone="warn">must change password</Badge>
          )}
          <Badge tone="neutral">
            account created {formatDate(profile.created_at)}
          </Badge>
        </div>
      </div>

      <Card>
        <CardHeader
          title={
            editable
              ? `Role and sector, ${editable.academic_years?.label ?? ctx.currentYear.label}`
              : "Role and sector"
          }
        />
        <div className="p-4 sm:p-6">
          {editable ? (
            <MembershipControls
              fund={ctx.fund.slug}
              membership={editable}
              sectors={sectors}
            />
          ) : (
            <p className="text-sm text-muted">
              Not a {ctx.fund.name} member for {ctx.currentYear.label}.
              Add them in{" "}
              <Link
                href={`/${ctx.fund.slug}/admin/members#add-member`}
                className="font-medium text-accent-text hover:underline"
              >
                Manage members
              </Link>{" "}
              to give them a role here.
            </p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Sign-in help" />
        <div className="space-y-3 p-4 sm:p-6">
          <p className="text-sm text-muted">
            {signedUp
              ? "Send a reset link when the member can reach their email. Set a temporary password when they can't."
              : "This member hasn't finished signing up. Resend the invite to email them a fresh link to set their password, or set a temporary password to give them in person."}{" "}
            Both are recorded in the audit log.
          </p>
          <PasswordTools userId={profile.id} invite={!signedUp} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Memberships" />
        <div className="p-4 sm:p-6">
          {memberships.length === 0 ? (
            <p className="text-sm text-muted">No memberships recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {memberships.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-highlight px-3 py-2 text-sm"
                >
                  <span>
                    <span className="font-medium">
                      {m.funds?.name ?? "—"}
                    </span>
                    <span className="text-muted">
                      {" "}
                      · {m.academic_years?.label ?? "—"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-muted">
                      {roleLabel(m.role, m.title_override)}
                      {m.sectors?.name && (
                        <>
                          {" · "}
                          <SectorLink
                            fund={m.funds?.slug ?? ctx.fund.slug}
                            slug={m.sectors.slug}
                            name={m.sectors.name}
                          />
                        </>
                      )}
                    </span>
                    {m.is_sector_leader && <Badge tone="accent">leader</Badge>}
                    <Badge
                      tone={
                        m.status === "active"
                          ? "gain"
                          : m.status === "alumni"
                          ? "neutral"
                          : "warn"
                      }
                    >
                      {m.status}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
