// /admin — cross-fund app admin: users and global flags, backup runs,
// environment health (SPEC 11.3).
//
// It sits outside the fund shell, so it carries its own ways back: "← <fund>"
// for the fund you came from (the smif_fund cookie), and both funds'
// dashboards and Fund admin, in display order.

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { FUND_DISPLAY_ORDER, getAccessibleFunds, getAuthState } from "@/lib/fund";
import { roleLabel } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  UsersTable,
  HealthPanel,
  type AdminMembership,
  type AdminUserRow,
} from "@/components/admin/AppAdminTools";
import { RunBackupButton } from "@/components/admin/RunBackupButton";
import { FUND_SHORT_NAMES } from "@/components/layout/fundNav";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { LinkButton, PageHeader } from "@/components/ui/PageHeader";
import { formatDateTime } from "@/lib/format";
import type {
  AcademicYear,
  BackupRun,
  Fund,
  Membership,
  Profile,
} from "@/types/domain";

// Named only for app admins. For anyone else the layout answers 404, and
// calling notFound() here too gives that 404 its own tab title ("Page not
// found") instead of naming the page they can't open. A signed-out visitor
// is left to the layout's redirect to sign in.
export async function generateMetadata(): Promise<Metadata> {
  const { user, profile } = await getAuthState();
  if (user && !profile?.is_app_admin) notFound();
  return profile?.is_app_admin ? { title: "App admin" } : {};
}

type MembershipRow = Membership & {
  funds: Pick<Fund, "name" | "slug"> | null;
  academic_years: Pick<AcademicYear, "label" | "starts_on" | "is_current"> | null;
};

/** This year first, then by fund in display order, then newest year first. */
function byRelevance(a: MembershipRow, b: MembershipRow): number {
  const current =
    Number(b.academic_years?.is_current ?? false) -
    Number(a.academic_years?.is_current ?? false);
  if (current !== 0) return current;
  const fund =
    FUND_DISPLAY_ORDER.indexOf(a.funds?.slug ?? "athena") -
    FUND_DISPLAY_ORDER.indexOf(b.funds?.slug ?? "athena");
  if (fund !== 0) return fund;
  return (b.academic_years?.starts_on ?? "").localeCompare(
    a.academic_years?.starts_on ?? ""
  );
}

export default async function AppAdminPage() {
  const { user, profile } = await getAuthState();
  if (!user || !profile) redirect("/login");

  const supabase = await createSupabaseServerClient();
  const [profilesRes, membershipsRes, runsRes, funds, cookieStore] =
    await Promise.all([
      supabase.from("profiles").select("*").order("full_name"),
      supabase
        .from("memberships")
        .select("*, funds(name, slug), academic_years(label, starts_on, is_current)"),
      supabase
        .from("backup_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(10),
      getAccessibleFunds(),
      cookies(),
    ]);

  const profiles = (profilesRes.data as Profile[]) ?? [];
  const memberships = ((membershipsRes.data as MembershipRow[]) ?? [])
    // Inactive rows are people taken off a roster; alumni stay, marked.
    .filter((m) => m.status !== "inactive" && m.funds)
    .sort(byRelevance);
  const runs = (runsRes.data as BackupRun[]) ?? [];

  const remembered = cookieStore.get("smif_fund")?.value;
  const backFund = funds.find((f) => f.slug === remembered) ?? funds[0] ?? null;
  const firstFund = funds[0]?.slug ?? "athena";

  const users: AdminUserRow[] = profiles.map((p) => {
    const own: AdminMembership[] = memberships
      .filter((m) => m.user_id === p.id)
      .map((m) => {
        const slug = m.funds?.slug ?? firstFund;
        return {
          id: m.id,
          label: `${FUND_SHORT_NAMES[slug]} ${m.academic_years?.label ?? ""}`.trim(),
          role: roleLabel(m.role, m.title_override),
          alumni: m.status === "alumni",
          href: `/${slug}/admin/members/${m.id}`,
        };
      });
    return {
      id: p.id,
      email: p.email,
      full_name: p.full_name,
      is_app_admin: p.is_app_admin,
      is_faculty_advisor: p.is_faculty_advisor,
      // Someone on no roster (the advisor, say) still has a record by
      // account id, which is where their sign-in help lives.
      href: own[0]?.href ?? `/${firstFund}/admin/members/${p.id}`,
      memberships: own,
    };
  });

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        back={
          backFund
            ? {
                href: `/${backFund.slug}`,
                label: FUND_SHORT_NAMES[backFund.slug],
              }
            : undefined
        }
        title="App admin"
        description="Accounts and global flags for both funds, environment health and backups."
      />

      <section aria-label="Funds" className="grid gap-3 sm:grid-cols-2">
        {funds.map((f) => (
          <div
            key={f.id}
            className="glass-card flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <p className="font-medium">{f.name}</p>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/${f.slug}`} variant="secondary">
                Dashboard
              </LinkButton>
              <LinkButton href={`/${f.slug}/admin`} variant="secondary">
                Fund admin
              </LinkButton>
            </div>
          </div>
        ))}
      </section>

      <Card>
        <CardHeader title="Users and global flags" />
        <div className="p-4 sm:p-6">
          <p className="mb-3 text-sm text-muted">
            App admins get full access to both funds and every admin tool (but
            never vote). The faculty advisor reads everything and can execute
            trades. Each name opens that person&apos;s member record.
          </p>
          <div className="mb-4 rounded-lg bg-highlight px-3 py-2.5 text-sm">
            <p className="text-muted">
              To add the faculty advisor, or anyone else who isn&apos;t a
              fund member: add them as a Viewer in a fund&apos;s Manage members,
              which creates their account and sends the invite. Then tick
              Advisor or App admin for them here.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {funds.map((f) => (
                <LinkButton
                  key={f.id}
                  href={`/${f.slug}/admin/members#add-member`}
                  variant="secondary"
                >
                  Manage members ({FUND_SHORT_NAMES[f.slug]})
                </LinkButton>
              ))}
            </div>
          </div>
          <UsersTable users={users} currentUserId={user.id} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Environment health" />
        <div className="p-4 sm:p-6">
          <HealthPanel />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Backup runs"
          action={<RunBackupButton />}
        />
        <div className="p-4 sm:p-6">
          {runs.length === 0 ? (
            <p className="text-sm text-muted">
              No backup has run yet. The nightly cron runs at 08:00 UTC, or run
              one now.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-highlight px-3 py-2 text-sm"
                >
                  <span>
                    {formatDateTime(r.started_at)}
                    <span className="text-muted">
                      {" "}
                      · {r.triggered_by === "cron" ? "cron" : "manual"}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {r.rows_written !== null && (
                      <span className="text-xs text-muted tabular-nums">
                        {r.tabs_written} tabs · {r.rows_written} rows
                      </span>
                    )}
                    <Badge
                      tone={
                        r.status === "ok"
                          ? "gain"
                          : r.status === "failed"
                          ? "loss"
                          : "neutral"
                      }
                      title={r.error ?? undefined}
                    >
                      {r.status}
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
