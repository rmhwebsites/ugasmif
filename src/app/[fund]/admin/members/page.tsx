// /[fund]/admin/members — roster table, add one member, CSV import/export
// (SPEC 11.3, 17.1). Roster managers only (the PM is excluded by the matrix).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  MemberEditor,
  AddMemberForm,
  type RosterRow,
} from "@/components/admin/MemberEditor";
import { RosterImport } from "@/components/admin/RosterImport";
import { Card, CardHeader } from "@/components/ui/Card";
import type { Sector } from "@/types/domain";

export const metadata: Metadata = { title: "Members" };

export default async function MembersAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!can(ctx, "manage_roster")) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="font-medium">Roster management</p>
        <p className="mt-1 text-sm text-muted">
          The president, vice president, alumni relations director, and app
          admins manage the roster. See the team page for the current roster.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const [membersRes, sectorsRes] = await Promise.all([
    supabase
      .from("memberships")
      .select("*, profiles(id, full_name, email)")
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold sm:text-3xl">Members</h1>
          <p className="mt-0.5 text-sm text-muted">
            {ctx.currentYear.label} · {members.length} on the roster
          </p>
        </div>
        <a
          href={`/api/${ctx.fund.slug}/roster/export`}
          className="rounded-lg border border-input-border bg-input-bg px-4 py-2 text-sm font-medium transition-colors hover:bg-highlight"
        >
          Export CSV
        </a>
      </div>

      <MemberEditor
        fund={ctx.fund.slug}
        members={members}
        sectors={sectors}
      />

      <Card>
        <CardHeader title="Add a member" />
        <div className="p-4 sm:p-6">
          <AddMemberForm fund={ctx.fund.slug} sectors={sectors} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Roster import" />
        <div className="p-4 sm:p-6">
          <RosterImport fund={ctx.fund.slug} />
        </div>
      </Card>
    </div>
  );
}
