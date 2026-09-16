// First-run onboarding. Roster import knows a member's email and full name;
// this collects the rest once, then never asks again (profiles.onboarded_at).

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthState, getCurrentYear } from "@/lib/fund";
import { SmifLogo } from "@/components/icons/SmifLogo";
import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import type { Fund, Membership, Sector } from "@/types/domain";

export const metadata: Metadata = { title: "Welcome" };

type MembershipRow = Membership & { funds: Pick<Fund, "name" | "slug"> | null };

export default async function OnboardingPage() {
  const { supabase, user, profile } = await getAuthState();
  if (!user) redirect("/login");
  if (!profile) redirect("/no-access");
  if (profile.onboarded_at) redirect("/");

  const year = await getCurrentYear(supabase);
  const { data: membershipRows } = year
    ? await supabase
        .from("memberships")
        .select("*, funds(name, slug)")
        .eq("user_id", user.id)
        .eq("academic_year_id", year.id)
        .eq("status", "active")
    : { data: [] };
  const memberships = (membershipRows as MembershipRow[]) ?? [];

  const { data: sectorRows } = await supabase
    .from("sectors")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  const sectors = (sectorRows as Sector[]) ?? [];

  // One sector picker per fund the member actually belongs to.
  const pickers = memberships.map((m) => ({
    membershipId: m.id,
    fundId: m.fund_id,
    fundName: m.funds?.name ?? "Fund",
    currentSectorId: m.sector_id,
    sectors: sectors
      .filter((s) => s.fund_id === m.fund_id)
      .map((s) => ({ id: s.id, name: s.name })),
  }));

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="glass-card w-full max-w-lg p-6 sm:p-8">
        <div className="mb-6 text-center">
          <SmifLogo className="mx-auto mb-4 h-16 w-16" />
          <h1 className="text-xl font-semibold sm:text-2xl">
            Welcome to SMIF Hub
          </h1>
          <p className="mt-1 text-sm text-muted">
            A few details before you start. This only happens once.
          </p>
        </div>
        <OnboardingForm
          email={profile.email}
          initialFirstName={profile.first_name ?? ""}
          initialLastName={profile.last_name ?? ""}
          initialPhone={profile.phone ?? ""}
          initialAvatarUrl={profile.avatar_url}
          userId={user.id}
          pickers={pickers}
        />
      </div>
    </main>
  );
}
