// Fund shell: resolves access (404 when the user isn't on this fund's
// roster and holds no global flag), applies the fund accent via data-fund,
// and renders the sidebar + top bar (spec Sections 7 and 10).

import { notFound, redirect } from "next/navigation";
import { getAccessibleFunds, getAuthState, getFundContext } from "@/lib/fund";
import { isOfficer, roleLabel } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/Sidebar";
import { FundSwitcher } from "@/components/layout/FundSwitcher";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { FundCookie } from "@/components/layout/FundCookie";
import { LogoutButton } from "@/components/auth/LogoutButton";
import type { FundSlug } from "@/types/domain";

export default async function FundLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const { user } = await getAuthState();
  if (!user) redirect("/login");

  const ctx = await getFundContext(slug);
  if (!ctx) {
    // Signed in but no access to this fund. If they have no fund at all,
    // send them to the explainer instead of a bare 404.
    const accessible = await getAccessibleFunds();
    if (accessible.length === 0) redirect("/no-access");
    notFound();
  }

  const accessible = await getAccessibleFunds();

  const headerLine = ctx.isAppAdmin
    ? "App Admin"
    : ctx.isFacultyAdvisor && !ctx.membership
    ? "Faculty Advisor"
    : `${roleLabel(ctx.role, ctx.membership?.title_override)}${
        ctx.sector ? ` · ${ctx.sector.name}` : ""
      }`;

  return (
    <div data-fund={ctx.fund.slug} className="flex min-h-screen">
      <FundCookie fund={ctx.fund.slug} />
      <Sidebar
        fund={ctx.fund.slug}
        fundName={ctx.fund.name}
        headerLine={headerLine}
        showAdmin={isOfficer(ctx) || ctx.isFacultyAdvisor || ctx.isAppAdmin}
        showAppAdmin={ctx.isAppAdmin}
      />
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center justify-end gap-2 border-b border-card-border bg-sticky px-4 py-2.5 backdrop-blur-xl sm:px-6">
          <FundSwitcher
            current={ctx.fund.slug}
            accessible={accessible.map((f) => f.slug as FundSlug)}
          />
          <ThemeToggle />
          <LogoutButton />
        </header>
        <main className="mx-auto max-w-6xl p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
