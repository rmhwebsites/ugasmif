// "Run backup now" for /admin (spec Section 15). Cross-fund, so there is no
// getFundContext here: POST runs a full backup for any current-year officer
// of either fund, the faculty advisor, or an app admin; GET returns the last
// 10 backup runs for the same audience. runBackup uses the service client
// internally (this is the backup route, where that is allowed); the
// permission check and the run listing use the user-scoped client so RLS
// still applies.

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthState, getCurrentYear } from "@/lib/fund";
import { OFFICER_ROLES } from "@/lib/permissions";
import { runBackup } from "@/lib/sheets/backup";
import { logAudit } from "@/lib/audit";
import type { BackupRun, Profile } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Officer of any fund this year, the faculty advisor, or an app admin. */
async function canAdminBackup(
  supabase: SupabaseClient,
  user: User,
  profile: Profile
): Promise<boolean> {
  if (profile.is_app_admin || profile.is_faculty_advisor) return true;
  const currentYear = await getCurrentYear(supabase);
  if (!currentYear) return false;
  const { data } = await supabase
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("academic_year_id", currentYear.id)
    .eq("status", "active")
    .in("role", OFFICER_ROLES)
    .limit(1);
  return ((data as { id: string }[]) ?? []).length > 0;
}

export async function POST() {
  const { supabase, user, profile } = await getAuthState();
  if (!user || !profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await canAdminBackup(supabase, user, profile))) {
    return NextResponse.json(
      {
        error:
          "Only fund officers, the faculty advisor, or an app admin can run a backup.",
      },
      { status: 403 }
    );
  }

  try {
    const run = await runBackup(user.id);

    await logAudit(supabase, {
      actorId: user.id,
      fundId: null,
      action: "backup.trigger",
      entity: "backup_runs",
      entityId: run.id,
      after: {
        status: run.status,
        tabs_written: run.tabs_written,
        rows_written: run.rows_written,
        error: run.error,
      },
    });

    return NextResponse.json(
      { ok: run.status === "ok", run },
      { status: run.status === "ok" ? 200 : 500 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("admin backup failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const { supabase, user, profile } = await getAuthState();
  if (!user || !profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await canAdminBackup(supabase, user, profile))) {
    return NextResponse.json(
      {
        error:
          "Only fund officers, the faculty advisor, or an app admin can view backup runs.",
      },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("backup_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ runs: (data as BackupRun[]) ?? [] });
}
