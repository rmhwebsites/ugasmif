// Fund shell: resolves access (404 when the user isn't on this fund's
// roster and holds no global flag), applies the fund accent via data-fund,
// and renders the sidebar (spec Sections 7 and 10). Everything that used to
// sit in a top bar (fund switcher, sign out) lives in the sidebar now, so on
// a desktop the page starts at its own title. Phones get a slim bar with the
// menu button and the fund's name.

import { notFound, redirect } from "next/navigation";
import { getAccessibleFunds, getAuthState, getFundContext } from "@/lib/fund";
import { can, isOfficer, roleLabel } from "@/lib/permissions";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  MobileNavProvider,
  MobileNavToggle,
} from "@/components/layout/MobileNav";
import { FundCookie } from "@/components/layout/FundCookie";
import { SmifLogo } from "@/components/icons/SmifLogo";
import type { FundSlug } from "@/types/domain";

export default async function FundLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ fund: string }>;
}) {
  const { fund: slug } = await params;
  const { supabase, user } = await getAuthState();
  if (!user) redirect("/login");

  const ctx = await getFundContext(slug);
  if (!ctx) {
    // Signed in but no access to this fund. If they have no fund at all,
    // send them to the explainer instead of a bare 404.
    const accessible = await getAccessibleFunds();
    if (accessible.length === 0) redirect("/no-access");
    notFound();
  }

  const [accessible, votingRes] = await Promise.all([
    getAccessibleFunds(),
    can(ctx, "cast_vote")
      ? supabase
          .from("pitches")
          .select("id")
          .eq("fund_id", ctx.fund.id)
          .eq("status", "voting")
      : Promise.resolve({ data: [] }),
  ]);

  // Open votes still waiting on this member, for the badge on Pitches.
  const votingIds = ((votingRes.data as { id: string }[] | null) ?? []).map(
    (p) => p.id
  );
  let votesWaiting = 0;
  if (votingIds.length > 0) {
    const { data: cast } = await supabase
      .from("votes")
      .select("pitch_id")
      .eq("voter_id", user.id)
      .in("pitch_id", votingIds);
    votesWaiting = votingIds.length - (cast?.length ?? 0);
  }

  const headerLine = ctx.isAppAdmin
    ? "App Admin"
    : ctx.isFacultyAdvisor && !ctx.membership
    ? "Faculty Advisor"
    : `${roleLabel(ctx.role, ctx.membership?.title_override)}${
        ctx.sector ? ` · ${ctx.sector.name}` : ""
      }`;

  return (
    <MobileNavProvider>
      <div data-fund={ctx.fund.slug} className="flex min-h-screen">
        <FundCookie fund={ctx.fund.slug} />
        <Sidebar
          fund={ctx.fund.slug}
          fundName={ctx.fund.name}
          headerLine={headerLine}
          accessible={accessible.map((f) => f.slug as FundSlug)}
          userName={ctx.profile.full_name}
          avatarUrl={ctx.profile.avatar_url}
          votesWaiting={votesWaiting}
          showAdmin={isOfficer(ctx) || ctx.isFacultyAdvisor || ctx.isAppAdmin}
          showAppAdmin={ctx.isAppAdmin}
        />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-card-border bg-sticky px-4 py-2.5 backdrop-blur-xl lg:hidden">
            <MobileNavToggle />
            <span className="flex min-w-0 items-center gap-2">
              <SmifLogo className="h-7 w-7 shrink-0" />
              <span className="truncate text-sm font-semibold">
                {ctx.fund.name}
              </span>
            </span>
          </header>
          <main className="mx-auto max-w-6xl p-4 sm:p-6 lg:pt-8">
            {children}
          </main>
        </div>
      </div>
    </MobileNavProvider>
  );
}
