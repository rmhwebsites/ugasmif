// Guard for /[fund]/admin/*: officers, the faculty advisor, and app admins
// (SPEC 11.3), plus the strategy-team leader, who sets sector targets
// (SPEC Section 6) and so needs /[fund]/admin/sectors. Individual pages
// tighten further (e.g. tickets requires canExecute, members requires
// manage_roster); the strategy-team leader gets a one-tab nav because the
// rest of the section is not theirs to open.

import Link from "next/link";
import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { isOfficer, leadsStrategyTeam } from "@/lib/permissions";
import { AdminNav } from "@/components/admin/AdminNav";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) notFound();

  const fullAccess = isOfficer(ctx) || ctx.isFacultyAdvisor || ctx.isAppAdmin;
  const targetsOnly = !fullAccess && leadsStrategyTeam(ctx);
  if (!fullAccess && !targetsOnly) notFound();

  return (
    <div className="space-y-4">
      {fullAccess ? (
        <AdminNav fund={ctx.fund.slug} />
      ) : (
        <nav className="flex gap-1 overflow-x-auto pb-1">
          <Link
            href={`/${ctx.fund.slug}/admin/sectors`}
            className="shrink-0 rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-medium text-accent"
          >
            Sectors
          </Link>
        </nav>
      )}
      {children}
    </div>
  );
}
