// Daily cron (08:00 UTC, vercel.json): full backup — every table to the
// branded Google Sheet plus a gzipped JSON export to the `backups` storage
// bucket (spec Sections 13.6, 15). runBackup records the run in backup_runs
// and emails app admins on failure. Bearer CRON_SECRET only.

import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runBackup } from "@/lib/sheets/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const run = await runBackup("cron");
    const summary = {
      ok: run.status === "ok",
      status: run.status,
      tabsWritten: run.tabs_written,
      rowsWritten: run.rows_written,
      error: run.error,
    };

    const service = createServiceClient();
    await service.from("audit_log").insert({
      actor_id: null,
      fund_id: null,
      action: "cron.backup",
      entity: "backup_runs",
      entity_id: run.id,
      after: summary,
    });

    return NextResponse.json(summary, { status: summary.ok ? 200 : 500 });
  } catch (err) {
    // runBackup only throws when the backup_runs bookkeeping row itself
    // cannot be written; everything else lands in a failed run row.
    const message = err instanceof Error ? err.message : String(err);
    console.error("cron backup failed:", err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
