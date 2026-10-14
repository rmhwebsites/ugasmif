// /[fund]/admin/updates, "Manage updates": post, pin and delete fund
// updates (SPEC 11.3).

import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, hasFundAdminAccess } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UpdateEditor } from "@/components/admin/UpdateEditor";
import { PageHeader, ViewLink } from "@/components/ui/PageHeader";
import type { FundUpdate } from "@/types/domain";
import { adminTitle } from "../admin-metadata";

export const generateMetadata = adminTitle("updates", "Manage updates");

export default async function UpdatesAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!hasFundAdminAccess(ctx)) notFound();

  const header = (
    <PageHeader
      title="Manage updates"
      description="Post, pin and delete updates."
      actions={
        <ViewLink href={`/${ctx.fund.slug}/updates`}>View updates</ViewLink>
      }
    />
  );

  if (!can(ctx, "post_updates")) {
    return (
      <div className="space-y-4 sm:space-y-6">
        {header}
        <p className="glass-card p-6 text-sm text-muted">
          Officers, the faculty advisor, and app admins post updates.
        </p>
      </div>
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase
    .from("fund_updates")
    .select("*")
    .eq("fund_id", ctx.fund.id)
    .order("published_at", { ascending: false });

  return (
    <div className="space-y-4 sm:space-y-6">
      {header}
      <UpdateEditor
        fund={ctx.fund.slug}
        updates={(data as FundUpdate[]) ?? []}
      />
    </div>
  );
}
