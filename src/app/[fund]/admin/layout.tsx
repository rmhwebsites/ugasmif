// Guard for /[fund]/admin/*: officers, the faculty advisor, and app admins
// (SPEC 11.3), plus the strategy-team leader, who sets sector targets
// (SPEC Section 6) and so needs /[fund]/admin/sectors. Individual pages
// tighten further (e.g. tickets requires canExecute, members requires
// manage_roster), and the tabs show only the sections this person can open.
// The strategy-team leader gets no tabs, because Manage sectors is the one
// admin page that is theirs; its "View sectors" is their way back.

import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import {
  adminSectionsFor,
  hasFundAdminAccess,
  leadsStrategyTeam,
} from "@/lib/permissions";
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

  const fullAccess = hasFundAdminAccess(ctx);
  const targetsOnly = !fullAccess && leadsStrategyTeam(ctx);
  if (!fullAccess && !targetsOnly) notFound();

  if (!fullAccess) return children;

  return (
    <div className="space-y-6">
      <AdminNav fund={ctx.fund.slug} sections={adminSectionsFor(ctx)} />
      {children}
    </div>
  );
}
