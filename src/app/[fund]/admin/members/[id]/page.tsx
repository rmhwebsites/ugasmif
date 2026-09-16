// /[fund]/admin/members/[id] — one member: their memberships across funds
// and years, plus the two password tools (SPEC Section 7).

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, roleLabel } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { PasswordTools } from "@/components/admin/PasswordTools";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import { formatDate } from "@/lib/format";
import type {
  AcademicYear,
  Fund,
  Membership,
  Profile,
  Sector,
} from "@/types/domain";

export const metadata: Metadata = { title: "Member" };

type MembershipRow = Membership & {
  funds: Pick<Fund, "name" | "slug"> | null;
  academic_years: Pick<AcademicYear, "label"> | null;
  sectors: Pick<Sector, "name"> | null;
};

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ fund: string; id: string }>;
}) {
  const { fund: slug, id } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!can(ctx, "manage_roster")) notFound();

  const supabase = await createSupabaseServerClient();
  const [profileRes, membershipsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("memberships")
      .select("*, funds(name, slug), academic_years(label), sectors(name)")
      .eq("user_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const profile = profileRes.data as Profile | null;
  if (!profile) notFound();
  const memberships = (membershipsRes.data as MembershipRow[]) ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <Link
          href={`/${ctx.fund.slug}/admin/members`}
          className="text-sm text-muted hover:text-foreground"
        >
          ← Back to members
        </Link>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">
          {profile.full_name}
        </h1>
        <p className="mt-0.5 text-sm text-muted">{profile.email}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {profile.is_app_admin && <Badge tone="accent">app admin</Badge>}
          {profile.is_faculty_advisor && (
            <Badge tone="info">faculty advisor</Badge>
          )}
          {profile.must_change_password && (
            <Badge tone="warn">must change password</Badge>
          )}
          <Badge tone="neutral">
            account created {formatDate(profile.created_at)}
          </Badge>
        </div>
      </div>

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
                      {m.sectors?.name ? ` · ${m.sectors.name}` : ""}
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

      <Card>
        <CardHeader title="Password" />
        <div className="space-y-3 p-4 sm:p-6">
          <p className="text-sm text-muted">
            Use the reset link when the member can reach their email. Use a
            temporary password when they can&apos;t (both are audit-logged).
          </p>
          <PasswordTools userId={profile.id} />
        </div>
      </Card>
    </div>
  );
}
