// /[fund]/admin/settings — vote rules, benchmark, domains, meeting day
// (SPEC 11.3). Officers and app admins; the API enforces the same rule.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { can, hasFundAdminAccess } from "@/lib/permissions";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { Card, CardHeader } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Fund Settings" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();
  if (!hasFundAdminAccess(ctx)) notFound();
  if (!can(ctx, "manage_fund_settings")) notFound();

  return (
    <div className="space-y-4 sm:space-y-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Fund Settings</h1>
      <Card>
        <CardHeader title={ctx.fund.name} />
        <div className="p-4 sm:p-6">
          <SettingsForm fund={ctx.fund} />
        </div>
      </Card>
    </div>
  );
}
