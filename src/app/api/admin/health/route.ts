// Environment health for /admin (spec Section 11.3): is Yahoo answering, is
// the Treasury curve fresh, did the last backup succeed, is the Resend domain
// verified, and can the service account actually reach the backup sheet. The
// last two are live probes, not env-var checks — a revoked key or a sheet
// nobody shared looks fine in the environment and fails at 9pm when the cron
// runs. Same audience as the backup button: any current-year fund officer,
// the faculty advisor, or an app admin. Reads go through the user-scoped
// client (RLS applies), and no check ever echoes a secret.

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getAuthState, getCurrentYear } from "@/lib/fund";
import { OFFICER_ROLES } from "@/lib/permissions";
import { getQuote } from "@/lib/yahoo";
import { checkResend, checkSheets } from "@/lib/health";
import type { BackupRun, Profile } from "@/types/domain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY_MS = 86_400_000;
/** The curve feed skips weekends and holidays; a week means the cron died. */
const CURVE_FRESH_DAYS = 7;

/** Officer of any fund this year, the faculty advisor, or an app admin. */
async function canViewHealth(
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

export async function GET() {
  const { supabase, user, profile } = await getAuthState();
  if (!user || !profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  if (!(await canViewHealth(supabase, user, profile))) {
    return NextResponse.json(
      {
        error:
          "Only fund officers, the faculty advisor, or an app admin can view system health.",
      },
      { status: 403 }
    );
  }

  // Yahoo Finance: one live quote for SPY. A stale result means Yahoo failed
  // and the price came from the price_snapshots fallback.
  let yahoo: {
    ok: boolean;
    price: number | null;
    stale: boolean;
    error?: string;
  };
  try {
    const quote = await getQuote("SPY");
    yahoo = quote
      ? { ok: !quote.stale, price: quote.price, stale: quote.stale }
      : {
          ok: false,
          price: null,
          stale: false,
          error: "No quote returned for SPY",
        };
  } catch (err) {
    yahoo = {
      ok: false,
      price: null,
      stale: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // Treasury curve: newest curve_date and its age.
  const { data: curveRow } = await supabase
    .from("treasury_curve")
    .select("curve_date")
    .order("curve_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestCurveDate =
    (curveRow as { curve_date: string } | null)?.curve_date ?? null;
  const curveAgeDays = latestCurveDate
    ? Math.floor(
        (Date.now() - Date.parse(`${latestCurveDate}T00:00:00Z`)) / DAY_MS
      )
    : null;
  const treasuryCurve = {
    ok: curveAgeDays !== null && curveAgeDays <= CURVE_FRESH_DAYS,
    latestDate: latestCurveDate,
    ageDays: curveAgeDays,
  };

  // Last backup run.
  const { data: runRow } = await supabase
    .from("backup_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastRun = (runRow as BackupRun | null) ?? null;
  const backup = { ok: lastRun?.status === "ok", lastRun };

  // Live probes, in parallel — each has its own timeout and never throws.
  const [resend, sheets] = await Promise.all([checkResend(), checkSheets()]);

  // An unconfigured integration is not a failure in dev, so the rollup only
  // counts things that are meant to be working.
  const configuredAndBroken =
    (resend.configured && !resend.ok) || (sheets.configured && !sheets.ok);

  return NextResponse.json({
    ok: yahoo.ok && treasuryCurve.ok && backup.ok && !configuredAndBroken,
    checkedAt: new Date().toISOString(),
    checks: {
      yahoo,
      treasuryCurve,
      backup,
      resend,
      sheets,
      // Kept so an older client reading these keys still renders.
      resendConfigured: resend.configured,
      googleSheetsConfigured: sheets.configured,
    },
  });
}
