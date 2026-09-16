// Guard for /[fund]/admin/*: officers, the faculty advisor, and app admins
// only (SPEC 11.3). Individual pages tighten further (e.g. tickets requires
// canExecute, members requires manage_roster).

import { notFound } from "next/navigation";
import { getFundContext } from "@/lib/fund";
import { isOfficer } from "@/lib/permissions";
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
  if (!(isOfficer(ctx) || ctx.isFacultyAdvisor || ctx.isAppAdmin)) {
    notFound();
  }

  return (
    <div className="space-y-4">
      <AdminNav fund={ctx.fund.slug} />
      {children}
    </div>
  );
}
