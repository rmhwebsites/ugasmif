// Server-side fund context resolution. Every /[fund]/ page and API route
// starts here: it loads the fund by slug, the caller's profile, and their
// membership for the current academic year, and answers "may this user see
// this fund at all?" (spec Section 7, "Fund resolution").

import { cache } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AcademicYear,
  Fund,
  FundContext,
  FundSlug,
  Membership,
  Profile,
  Sector,
} from "@/types/domain";
import { effectiveRole } from "@/lib/permissions";

export function isFundSlug(value: string): value is FundSlug {
  return value === "athena" || value === "arch";
}

interface AuthState {
  supabase: SupabaseClient;
  user: User | null;
  profile: Profile | null;
}

/** Authenticated user + profile, memoized per request. */
export const getAuthState = cache(async (): Promise<AuthState> => {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { supabase, user, profile: (profile as Profile) ?? null };
});

export const getCurrentYear = cache(
  async (supabase: SupabaseClient): Promise<AcademicYear | null> => {
    const { data } = await supabase
      .from("academic_years")
      .select("*")
      .eq("is_current", true)
      .maybeSingle();
    return (data as AcademicYear) ?? null;
  }
);

/**
 * Resolves the full fund context for the signed-in user, or null when the
 * user has no access to this fund (caller should notFound()).
 */
export const getFundContext = cache(
  async (slug: string): Promise<FundContext | null> => {
    if (!isFundSlug(slug)) return null;
    const { supabase, user, profile } = await getAuthState();
    if (!user || !profile) return null;

    const { data: fundRow } = await supabase
      .from("funds")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (!fundRow) return null;
    const fund = fundRow as Fund;

    const currentYear = await getCurrentYear(supabase);
    if (!currentYear) return null;

    // Current-year membership first, else the most recent alumni membership.
    const { data: current } = await supabase
      .from("memberships")
      .select("*")
      .eq("user_id", user.id)
      .eq("fund_id", fund.id)
      .eq("academic_year_id", currentYear.id)
      .maybeSingle();

    let membership: Membership | null = (current as Membership | null) ?? null;
    if (!membership) {
      const { data: past } = await supabase
        .from("memberships")
        .select("*")
        .eq("user_id", user.id)
        .eq("fund_id", fund.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const pastRow = (past?.[0] as Membership) ?? null;
      // A past-year membership counts as alumni access
      membership = pastRow ? { ...pastRow, status: "alumni" } : null;
    }

    const hasAccess =
      profile.is_app_admin || profile.is_faculty_advisor || membership !== null;
    if (!hasAccess) return null;

    let sector: Sector | null = null;
    if (membership?.sector_id) {
      const { data: sectorRow } = await supabase
        .from("sectors")
        .select("*")
        .eq("id", membership.sector_id)
        .maybeSingle();
      sector = (sectorRow as Sector) ?? null;
    }

    // Mirrors the SQL helper alumni_view_horizon(): a past-year or alumni
    // membership loses the live book when the fund turns the setting off.
    const isCurrentMember =
      membership !== null &&
      membership.status === "active" &&
      membership.academic_year_id === currentYear.id;
    const canViewCurrent =
      profile.is_app_admin ||
      profile.is_faculty_advisor ||
      isCurrentMember ||
      fund.settings.alumni_can_view_current !== false;

    const ctx: FundContext = {
      fund,
      profile,
      membership,
      sector,
      currentYear,
      role: null,
      isAppAdmin: profile.is_app_admin,
      isFacultyAdvisor: profile.is_faculty_advisor,
      canViewCurrent,
    };
    ctx.role = effectiveRole(ctx);
    return ctx;
  }
);

/**
 * The order funds are listed in everywhere: the stock fund, then the bond
 * fund, as the Athena | Arch switcher shows them. Alphabetical order would
 * put Arch first.
 */
export const FUND_DISPLAY_ORDER: FundSlug[] = ["athena", "arch"];

function byDisplayOrder(a: Fund, b: Fund): number {
  return FUND_DISPLAY_ORDER.indexOf(a.slug) - FUND_DISPLAY_ORDER.indexOf(b.slug);
}

/** The funds this user can access, in display order — drives the switcher. */
export const getAccessibleFunds = cache(async (): Promise<Fund[]> => {
  const { supabase, user, profile } = await getAuthState();
  if (!user || !profile) return [];

  const { data: fundRows } = await supabase.from("funds").select("*");
  const funds = ((fundRows as Fund[]) ?? []).sort(byDisplayOrder);

  if (profile.is_app_admin || profile.is_faculty_advisor) return funds;

  const { data: membershipRows } = await supabase
    .from("memberships")
    .select("fund_id")
    .eq("user_id", user.id);
  const memberFundIds = new Set(
    ((membershipRows as { fund_id: string }[]) ?? []).map((m) => m.fund_id)
  );
  return funds.filter((f) => memberFundIds.has(f.id));
});

/**
 * How much this person has to do in a fund, lowest first: a seat this year
 * with a role, then a viewer seat this year, then alumni access, then access
 * through the advisor or app admin flag alone.
 */
function landingRank(ctx: FundContext | null): number {
  if (!ctx) return 4;
  const m = ctx.membership;
  if (!m) return 3;
  const thisYear =
    m.status === "active" && m.academic_year_id === ctx.currentYear.id;
  if (thisYear && m.role !== "viewer") return 0;
  if (thisYear) return 1;
  return 2;
}

/**
 * Where "/" lands when no fund is remembered: the fund where this person has
 * the most to do, ties going to display order (Athena first). `funds` comes
 * from getAccessibleFunds(), which is already in display order.
 */
export async function pickLandingFund(funds: Fund[]): Promise<Fund | null> {
  if (funds.length === 0) return null;
  const ranks = await Promise.all(
    funds.map(async (f) => landingRank(await getFundContext(f.slug)))
  );
  let best = 0;
  for (let i = 1; i < funds.length; i++) {
    if (ranks[i] < ranks[best]) best = i;
  }
  return funds[best];
}
