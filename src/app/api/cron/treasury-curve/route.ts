// Daily cron (21:30 UTC weekdays, vercel.json): fetch the Treasury par
// yield curve feed and upsert the newest day's rows into treasury_curve
// (spec 13.2 / 13.6). Bearer CRON_SECRET only.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchTreasuryCurve } from "@/lib/bonds/treasury";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  try {
    const year = new Date().getFullYear();
    const points = await fetchTreasuryCurve(year);
    if (points.length === 0) {
      return NextResponse.json({
        ok: true,
        curveDate: null,
        upserted: 0,
        note: "Treasury feed returned no rows",
      });
    }

    // The feed lags on holidays — take its most recent published date.
    const curveDate = points.reduce(
      (max, p) => (p.curve_date > max ? p.curve_date : max),
      points[0].curve_date
    );
    const todays = points.filter((p) => p.curve_date === curveDate);

    const { error } = await service
      .from("treasury_curve")
      .upsert(todays, { onConflict: "curve_date,tenor_months" });
    if (error) throw new Error(error.message);

    const summary = { ok: true, curveDate, upserted: todays.length };

    await service.from("audit_log").insert({
      actor_id: null,
      fund_id: null,
      action: "cron.treasury-curve",
      entity: "treasury_curve",
      entity_id: curveDate,
      after: summary,
    });

    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("cron treasury-curve failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
