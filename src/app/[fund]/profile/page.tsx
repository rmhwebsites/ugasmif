// /[fund]/profile — name, avatar, email preferences, password (SPEC 11.2).
// Server component loads the account card (email + roles across both funds,
// read-only); the ProfileForm client island does the editing.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Mail, ShieldCheck } from "lucide-react";
import { getAuthState, getFundContext } from "@/lib/fund";
import { roleLabel } from "@/lib/permissions";
import { ProfileForm } from "@/components/profile/ProfileForm";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader } from "@/components/ui/Card";
import type { MembershipRole, MembershipStatus } from "@/types/domain";

export const metadata: Metadata = { title: "Profile" };

/** memberships row with the joins this page selects. */
interface RoleRow {
  role: MembershipRole;
  status: MembershipStatus;
  is_sector_leader: boolean;
  title_override: string | null;
  fund: { name: string; slug: string } | null;
  sector: { name: string } | null;
}

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const { supabase } = await getAuthState();
  const { data } = await supabase
    .from("memberships")
    .select(
      "role, status, is_sector_leader, title_override, fund:funds(name, slug), sector:sectors(name)"
    )
    .eq("user_id", ctx.profile.id)
    .eq("academic_year_id", ctx.currentYear.id)
    .order("created_at", { ascending: true });
  const roles = (data as unknown as RoleRow[] | null) ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Profile</h1>
        <p className="mt-1 text-xs text-muted sm:text-sm">
          How you appear across SMIF Hub, and how it reaches you.
        </p>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <ProfileForm
            userId={ctx.profile.id}
            initial={{
              full_name: ctx.profile.full_name,
              avatar_url: ctx.profile.avatar_url,
              email_prefs: ctx.profile.email_prefs ?? {},
            }}
          />
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="Account" />
            <div className="space-y-4 p-4 sm:p-6">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted">
                  Email
                </p>
                <p className="mt-1 flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted" aria-hidden="true" />
                  {ctx.profile.email}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Sign-in email — officers manage this on the roster.
                </p>
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted">
                  Roles this year ({ctx.currentYear.label})
                </p>
                {roles.length === 0 &&
                !ctx.isAppAdmin &&
                !ctx.isFacultyAdvisor ? (
                  <p className="mt-1 text-sm text-muted">
                    No membership for the current year — ask a SMIF officer to
                    add you to the roster.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {roles.map((r, i) => (
                      <li key={i} className="text-sm">
                        <span className="font-medium">
                          {r.fund?.name ?? "Fund"}
                        </span>
                        <span className="text-muted">
                          {" — "}
                          {roleLabel(
                            r.status === "active" ? r.role : "viewer",
                            r.status === "active" ? r.title_override : null
                          )}
                          {r.sector?.name ? ` · ${r.sector.name}` : ""}
                        </span>{" "}
                        {r.is_sector_leader && r.status === "active" && (
                          <Badge tone="accent">Sector leader</Badge>
                        )}
                        {r.status !== "active" && (
                          <Badge tone="neutral">{r.status}</Badge>
                        )}
                      </li>
                    ))}
                    {ctx.isAppAdmin && (
                      <li className="text-sm">
                        <Badge tone="accent">
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                          App admin
                        </Badge>{" "}
                        <span className="text-muted">
                          Full access to both funds, no vote.
                        </span>
                      </li>
                    )}
                    {ctx.isFacultyAdvisor && (
                      <li className="text-sm">
                        <Badge tone="info">Faculty advisor</Badge>{" "}
                        <span className="text-muted">
                          Reads everything, executes trades.
                        </span>
                      </li>
                    )}
                  </ul>
                )}
                <p className="mt-2 text-xs text-muted">
                  Roles are set by the officers on the roster — this card is
                  read-only.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
