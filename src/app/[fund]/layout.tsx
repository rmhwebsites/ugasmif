// Fund shell: resolves access, applies the fund accent via data-fund, and
// renders the sidebar (spec Sections 7 and 10). Everything that used to sit
// in a top bar (fund switcher, sign out) lives in the sidebar now, so on a
// desktop the page starts at its own title. Phones get a slim bar with the
// menu button, the fund's name (a link home) and the page you are on.
//
// Someone signed in who is on another fund's roster but not this one gets a
// short explanation with a link to their fund instead of a bare 404.

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  getAccessibleFunds,
  getAuthState,
  getFundContext,
  isFundSlug,
} from "@/lib/fund";
import {
  adminSectionsFor,
  can,
  hasFundAdminAccess,
  inSector,
  leadsStrategyTeam,
  roleLabel,
} from "@/lib/permissions";
import { Sidebar } from "@/components/layout/Sidebar";
import {
  MobileNavProvider,
  MobileNavToggle,
  MobileTitle,
} from "@/components/layout/MobileNav";
import { FundCookie } from "@/components/layout/FundCookie";
import { NotOnRoster } from "@/components/layout/NotOnRoster";
import {
  FUND_SHORT_NAMES,
  type FundNavOptions,
} from "@/components/layout/fundNav";
import type { FundSlug } from "@/types/domain";

// Tab titles name the fund, so two tabs open on Holdings can be told apart:
// "Holdings · Athena · SMIF Hub". Pages export a plain title; a page without
// one (the dashboard) gets the fund's full name.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ fund: string }>;
}): Promise<Metadata> {
  const { fund: slug } = await params;
  // An address like /nope names no fund; the layout body answers it with the
  // app-wide 404, so the tab says so too.
  if (!isFundSlug(slug)) return { title: { absolute: "Page not found · SMIF Hub" } };
  const ctx = await getFundContext(slug);
  const short = FUND_SHORT_NAMES[slug];
  return {
    title: {
      template: `%s · ${short} · SMIF Hub`,
      // The root layout's template adds " · SMIF Hub".
      default: ctx?.fund.name ?? short,
    },
  };
}

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
    // send them to the explainer; if they are on the other fund, say so and
    // point them there. An address that names no fund is a plain 404.
    const accessible = await getAccessibleFunds();
    if (accessible.length === 0) redirect("/no-access");
    if (!isFundSlug(slug) || accessible.some((f) => f.slug === slug)) {
      notFound();
    }
    return (
      <NotOnRoster fundName={FUND_SHORT_NAMES[slug]} funds={accessible} />
    );
  }

  // Alongside the open votes: the Fund admin sections this person can open
  // in each of their funds, so the switcher keeps you on an admin page only
  // where it opens for you. getFundContext is cached per request, so this
  // fund's context is not fetched twice.
  const accessiblePromise = getAccessibleFunds();
  const [accessible, accessibleContexts, votingRes] = await Promise.all([
    accessiblePromise,
    accessiblePromise.then((funds) =>
      Promise.all(funds.map((f) => getFundContext(f.slug)))
    ),
    can(ctx, "cast_vote")
      ? supabase
          .from("pitches")
          .select("id")
          .eq("fund_id", ctx.fund.id)
          .eq("status", "voting")
      : Promise.resolve({ data: [] }),
  ]);
  const adminSections: Partial<Record<FundSlug, string[]>> = {};
  accessible.forEach((f, i) => {
    const c = accessibleContexts[i];
    if (c) adminSections[f.slug] = [...adminSectionsFor(c)];
  });

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

  const showAdmin = hasFundAdminAccess(ctx);
  const nav: FundNavOptions = {
    fund: ctx.fund.slug,
    // Only a current, active seat on a sector team gets the shortcut.
    mySector:
      ctx.sector && inSector(ctx, ctx.sector.id)
        ? { slug: ctx.sector.slug, name: ctx.sector.name }
        : null,
    votesWaiting,
    showAdmin,
    showSectorTargets: !showAdmin && leadsStrategyTeam(ctx),
    showAppAdmin: ctx.isAppAdmin,
  };

  return (
    <MobileNavProvider>
      <div data-fund={ctx.fund.slug} className="flex min-h-screen">
        {/* First tab stop on every fund page: past the sidebar's dozen or
            so controls, straight to the page. */}
        <a
          href="#main"
          className="fixed top-3 left-3 z-60 -translate-y-[200%] rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-lg focus:translate-y-0"
        >
          Skip to content
        </a>
        <FundCookie fund={ctx.fund.slug} />
        <Sidebar
          nav={nav}
          fundName={ctx.fund.name}
          headerLine={headerLine}
          accessible={accessible.map((f) => f.slug as FundSlug)}
          adminSections={adminSections}
          userName={ctx.profile.full_name}
          avatarUrl={ctx.profile.avatar_url}
        />
        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-card-border bg-sticky px-4 py-1.5 backdrop-blur-xl lg:hidden">
            <MobileNavToggle votesWaiting={votesWaiting} />
            <MobileTitle nav={nav} fundName={ctx.fund.name} />
          </header>
          <main
            id="main"
            tabIndex={-1}
            className="mx-auto max-w-6xl p-4 outline-none sm:p-6 lg:pt-8"
          >
            {children}
          </main>
        </div>
      </div>
    </MobileNavProvider>
  );
}
