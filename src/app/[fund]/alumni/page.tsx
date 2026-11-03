// /[fund]/alumni — everyone who has been through SMIF, from both funds: name,
// LinkedIn, the years they were in, their roles, and the pitches they worked
// on. Open to anyone with access to either fund, so an Arch analyst can find
// an Athena alum and the other way round.
//
// Row level security keeps each fund's roster and pitches to itself, so the
// list comes from alumni_directory() (migration 0007), which returns only
// these fields. Who counts as an alum and which pitches they get credit for
// is decided there.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAccessibleFunds, getAuthState, getFundContext } from "@/lib/fund";
import { canOpenAdminSection } from "@/lib/permissions";
import { sortAlumni, toAlum, type AlumRow } from "@/lib/alumni";
import { AlumniDirectory } from "@/components/team/AlumniDirectory";
import { ManageLink, PageHeader } from "@/components/ui/PageHeader";
import type { FundSlug } from "@/types/domain";

export const metadata: Metadata = { title: "Alumni" };

export default async function AlumniPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const { supabase } = await getAuthState();
  const [{ data, error }, accessible] = await Promise.all([
    supabase.rpc("alumni_directory"),
    getAccessibleFunds(),
  ]);
  const alumni = sortAlumni(((data as AlumRow[] | null) ?? []).map(toAlum));
  const managesMembers = canOpenAdminSection(ctx, "members");

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="Alumni"
        description="Everyone who has been through SMIF: the years they were in, their roles, and the pitches their team took to a vote."
        actions={
          managesMembers ? (
            <ManageLink href={`/${ctx.fund.slug}/admin/members`}>
              Manage members
            </ManageLink>
          ) : undefined
        }
      />
      {error ? (
        <p className="glass-card p-6 text-sm text-loss">
          The alumni list couldn&apos;t be loaded. Try again in a minute.
        </p>
      ) : (
        <AlumniDirectory
          alumni={alumni}
          linkable={accessible.map((f) => f.slug as FundSlug)}
          manageFund={managesMembers ? ctx.fund.slug : null}
        />
      )}
    </div>
  );
}
