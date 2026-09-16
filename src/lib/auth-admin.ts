// Shared check for the officer password tools (SPEC Section 7): may the
// actor reset the target member's password? Server-only.

import "server-only";
import { getCurrentYear } from "@/lib/fund";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import type { Membership, Profile } from "@/types/domain";

const ROSTER_ROLES = ["president", "vice_president", "alumni_relations"];

/**
 * App admin always; otherwise the actor needs an active roster-manager
 * membership (president / VP / alumni relations — not the PM) in a fund
 * where the target holds any membership this year.
 */
export async function actorMayResetTarget(
  actorProfile: Profile,
  actorId: string,
  targetId: string
): Promise<boolean> {
  if (actorProfile.is_app_admin) return true;
  const service = createServiceClient();
  const supabase = await createSupabaseServerClient();
  const year = await getCurrentYear(supabase);
  if (!year) return false;

  const { data: actorRows } = await service
    .from("memberships")
    .select("fund_id, role, status")
    .eq("user_id", actorId)
    .eq("academic_year_id", year.id)
    .eq("status", "active");
  const managedFundIds = ((actorRows as Membership[]) ?? [])
    .filter((m) => ROSTER_ROLES.includes(m.role))
    .map((m) => m.fund_id);
  if (managedFundIds.length === 0) return false;

  const { data: targetRows } = await service
    .from("memberships")
    .select("fund_id")
    .eq("user_id", targetId)
    .eq("academic_year_id", year.id)
    .in("fund_id", managedFundIds);
  return ((targetRows as { fund_id: string }[]) ?? []).length > 0;
}
