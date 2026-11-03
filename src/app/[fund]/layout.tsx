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
import { BallotPrompt, type PromptPitch } from "@/components/pitch/BallotPrompt";
import { defaultOptions, orderOptions, toView } from "@/lib/ballot";
import { NotOnRoster } from "@/components/layout/NotOnRoster";
import {
  FUND_SHORT_NAMES,
  type FundNavOptions,
} from "@/components/layout/fundNav";
import type { FundSlug, VoteOption } from "@/types/domain";

interface VotingPitchRow {
  id: string;
  title: string;
  sector_id: string;
  proposed_amount: number | null;
  vote_opens_at: string | null;
  vote_closes_at: string | null;
  sector: { name: string } | null;
  author: { full_name: string } | null;
}

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
          .select(
            "id, title, sector_id, proposed_amount, vote_opens_at, vote_closes_at, sector:sectors(name), author:profiles!author_id(full_name)"
          )
          .eq("fund_id", ctx.fund.id)
          .eq("status", "voting")
          .order("vote_closes_at")
      : Promise.resolve({ data: [] }),
  ]);
  const adminSections: Partial<Record<FundSlug, string[]>> = {};
  accessible.forEach((f, i) => {
    const c = accessibleContexts[i];
    if (c) adminSections[f.slug] = [...adminSectionsFor(c)];
  });

  // Open votes still waiting on this member, for the badge on Pitches and
  // the pop-up ballot. Members only ever see their own fund's pitches here,
  // so an Arch analyst gets Arch votes and an Athena analyst Athena ones.
  const voting = (votingRes.data as unknown as VotingPitchRow[] | null) ?? [];
  const votingIds = voting.map((p) => p.id);
  let votesWaiting = 0;
  let prompt: PromptPitch[] = [];
  if (votingIds.length > 0) {
    const { data: cast } = await supabase
      .from("votes")
      .select("pitch_id")
      .eq("voter_id", user.id)
      .in("pitch_id", votingIds);
    const castIds = new Set(((cast as { pitch_id: string }[] | null) ?? []).map((v) => v.pitch_id));
    votesWaiting = votingIds.length - castIds.size;

    // The pop-up asks only where this member's ballot would be taken: the
    // window is open now, and the fund lets the pitching sector vote on its
    // own pitch or this isn't their sector's.
    const now = new Date().getTime();
    const sectorCanVote = ctx.fund.settings?.sector_can_vote_on_own_pitch !== false;
    const ask = voting.filter(
      (p) =>
        !castIds.has(p.id) &&
        p.vote_opens_at !== null &&
        p.vote_closes_at !== null &&
        new Date(p.vote_opens_at).getTime() <= now &&
        new Date(p.vote_closes_at).getTime() > now &&
        (sectorCanVote || !inSector(ctx, p.sector_id))
    );
    if (ask.length > 0) {
      const { data: optionRows } = await supabase
        .from("pitch_vote_options")
        .select("*")
        .in(
          "pitch_id",
          ask.map((p) => p.id)
        );
      const byPitch = new Map<string, VoteOption[]>();
      for (const o of (optionRows as VoteOption[] | null) ?? []) {
        byPitch.set(o.pitch_id, [...(byPitch.get(o.pitch_id) ?? []), o]);
      }
      prompt = ask.map((p) => {
        const proposed = p.proposed_amount === null ? null : Number(p.proposed_amount);
        const options = orderOptions(byPitch.get(p.id) ?? []);
        return {
          id: p.id,
          title: p.title,
          byline: [p.sector?.name, p.author?.full_name ? `pitched by ${p.author.full_name}` : null]
            .filter(Boolean)
            .join(" · "),
          closesAt: p.vote_closes_at as string,
          options:
            options.length > 0
              ? options.map((o) => toView(o, proposed))
              : defaultOptions(proposed),
        };
      });
    }
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
          {prompt.length > 0 && <BallotPrompt fund={ctx.fund.slug} pitches={prompt} />}
        </div>
      </div>
    </MobileNavProvider>
  );
}
