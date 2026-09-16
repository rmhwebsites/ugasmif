// /[fund]/admin/updates — post and manage fund updates (SPEC 11.3).

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { UpdateEditor } from "@/components/admin/UpdateEditor";
import { Card, CardHeader } from "@/components/ui/Card";
import type { FundUpdate } from "@/types/domain";

export const metadata: Metadata = { title: "Updates Admin" };

export default async function UpdatesAdminPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  if (!can(ctx, "post_updates")) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="font-medium">Updates</p>
        <p className="mt-1 text-sm text-muted">
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
      <h1 className="text-2xl font-bold sm:text-3xl">Updates</h1>
      <Card>
        <CardHeader title="Post an update" />
        <div className="p-4 sm:p-6">
          <UpdateEditor
            fund={ctx.fund.slug}
            updates={(data as FundUpdate[]) ?? []}
          />
        </div>
      </Card>
    </div>
  );
}
