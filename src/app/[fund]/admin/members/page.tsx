// /[fund]/admin/members — roster table, add one member, CSV import/export
// (SPEC 11.3, 17.1). Roster managers only (the PM is excluded by the matrix).
// #add-member and #roster-import are the two forms below the table.

import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, hasFundAdminAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  MemberEditor,
  AddMemberForm,
  type RosterRow,
} from "@/components/admin/MemberEditor";
import { RosterImport } from "@/components/admin/RosterImport";
import { Card, CardHeader } from "@/components/ui/Card";
import { LinkButton, PageHeader, ViewLink } from "@/components/ui/PageHeader";
import type { Sector } from "@/types/domain";
import { adminTitle } from "../admin-metadata";

export const generateMetadata = adminTitle("members", "Manage members");

export default async function MembersAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!hasFundAdminAccess(ctx)) notFound();

  const viewTeam = (
    <ViewLink href={`/${ctx.fund.slug}/team`}>View team</ViewLink>
  );

  if (!can(ctx, "manage_roster")) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <PageHeader title="Manage members" actions={viewTeam} />
        <p className="glass-card p-6 text-sm text-muted">
          The president, vice president, director of alumni relations, and
          app admins manage members.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const [membersRes, sectorsRes] = await Promise.all([
    supabase
      .from("memberships")
      .select("*, profiles(id, full_name, email, onboarded_at)")
      .eq("fund_id", ctx.fund.id)
      .eq("academic_year_id", ctx.currentYear.id)
      .order("role"),
    supabase
      .from("sectors")
      .select("id, name")
      .eq("fund_id", ctx.fund.id)
      .eq("is_active", true)
      .order("sort_order"),
  ]);

  const members = (membersRes.data as RosterRow[]) ?? [];
  const sectors = (sectorsRes.data as Pick<Sector, "id" | "name">[]) ?? [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Manage members"
        description={`${ctx.currentYear.label} · ${members.length} ${members.length === 1 ? "member" : "members"}`}
        actions={
          <>
            {viewTeam}
            <LinkButton href="#add-member">Add a member</LinkButton>
            <LinkButton href="#roster-import" variant="secondary">
              Import roster
            </LinkButton>
            <a
              href={`/api/${ctx.fund.slug}/roster/export`}
              className="inline-flex items-center rounded-lg bg-highlight px-3.5 py-2 text-sm font-medium whitespace-nowrap transition-colors hover:bg-card-border"
            >
              Export CSV
            </a>
          </>
        }
      />

      <MemberEditor
        fund={ctx.fund.slug}
        members={members}
        sectors={sectors}
      />

      <section id="add-member" className="scroll-mt-20 lg:scroll-mt-6">
        <Card>
          <CardHeader title="Add a member" />
          <div className="p-4 sm:p-6">
            <AddMemberForm fund={ctx.fund.slug} sectors={sectors} />
          </div>
        </Card>
      </section>

      <section id="roster-import" className="scroll-mt-20 lg:scroll-mt-6">
        <Card>
          <CardHeader title="Roster import" />
          <div className="p-4 sm:p-6">
            <RosterImport fund={ctx.fund.slug} />
          </div>
        </Card>
      </section>
    </div>
  );
}
