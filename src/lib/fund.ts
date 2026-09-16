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

    const ctx: FundContext = {
      fund,
      profile,
      membership,
      sector,
      currentYear,
      role: null,
      isAppAdmin: profile.is_app_admin,
      isFacultyAdvisor: profile.is_faculty_advisor,
    };
    ctx.role = effectiveRole(ctx);
    return ctx;
  }
);

/** The funds this user can access, in display order — drives the switcher. */
export const getAccessibleFunds = cache(async (): Promise<Fund[]> => {
  const { supabase, user, profile } = await getAuthState();
  if (!user || !profile) return [];

  const { data: fundRows } = await supabase
    .from("funds")
    .select("*")
    .order("slug");
  const funds = (fundRows as Fund[]) ?? [];

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
