// /[fund]/admin/settings — vote rules, benchmark, domains, meeting day
// (SPEC 11.3). Officers and app admins; the API enforces the same rule.
// "History" opens the audit log filtered to this fund's settings changes.

import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { getFundContext } from "@/lib/fund";
import { can, hasFundAdminAccess } from "@/lib/permissions";
import { SettingsForm } from "@/components/admin/SettingsForm";
import { Card, CardHeader } from "@/components/ui/Card";
import { LinkButton, PageHeader } from "@/components/ui/PageHeader";
import { adminTitle } from "../admin-metadata";

export const generateMetadata = adminTitle("settings", "Fund settings");

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
      <PageHeader
        title="Fund settings"
        description={`Vote rules, meeting day, benchmark, allowed email domains and alumni access for ${ctx.fund.name}.`}
        actions={
          can(ctx, "view_audit_log") && (
            <LinkButton
              href={`/${ctx.fund.slug}/admin/audit?entity=funds`}
              variant="secondary"
            >
              <History className="h-4 w-4" aria-hidden="true" />
              History
            </LinkButton>
          )
        }
      />
      <Card>
        <CardHeader title={ctx.fund.name} />
        <div className="p-4 sm:p-6">
          <SettingsForm fund={ctx.fund} />
        </div>
      </Card>
    </div>
  );
}
