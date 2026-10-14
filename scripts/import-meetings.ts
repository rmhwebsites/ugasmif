/**
 * Load a fund's semester calendar.
 *
 *   npm run import-meetings -- arch path/to/meetings.json
 *
 * The PM keeps the schedule in a spreadsheet, one row per week. A small
 * extractor turns it into {meeting_date, title, notes}; see HANDOVER.md.
 *
 * Matched on date, so re-running an updated calendar moves titles around
 * rather than duplicating the term. Dates the new calendar drops are removed,
 * but only if nobody has taken attendance against them — a session that
 * happened is a record, not a plan, and deleting it would take its attendance
 * with it.
 */

import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local", quiet: true });

interface Meeting {
  meeting_date: string;
  title: string;
  notes?: string | null;
}

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function main() {
  const [slug, file] = process.argv.slice(2);
  if (!slug || !file) {
    throw new Error("usage: npm run import-meetings -- <fund-slug> path/to/meetings.json");
  }
  const rows: Meeting[] = JSON.parse(readFileSync(file, "utf8"));

  const db = client();
  const { data: fund, error: fundError } = await db
    .from("funds")
    .select("id, name")
    .eq("slug", slug)
    .single();
  if (fundError || !fund) throw fundError ?? new Error(`fund ${slug} not found`);

  const { data: current, error: currentError } = await db
    .from("meetings")
    .select("id, meeting_date")
    .eq("fund_id", fund.id);
  if (currentError) throw currentError;

  const byDate = new Map((current ?? []).map((m) => [m.meeting_date, m.id]));
  const wanted = new Set(rows.map((r) => r.meeting_date));

  let updated = 0;
  let added = 0;
  for (const r of rows) {
    const payload = {
      fund_id: fund.id,
      meeting_date: r.meeting_date,
      title: r.title,
      notes: r.notes ?? null,
    };
    const id = byDate.get(r.meeting_date);
    if (id) {
      const { error } = await db.from("meetings").update(payload).eq("id", id);
      if (error) throw error;
      updated += 1;
    } else {
      const { error } = await db.from("meetings").insert(payload);
      if (error) throw error;
      added += 1;
    }
  }

  // A dropped date is only a plan that changed if nothing was recorded against
  // it. Attendance cascades on delete, so anything with records is left alone.
  const dropped = (current ?? []).filter((m) => !wanted.has(m.meeting_date));
  let removed = 0;
  let kept = 0;
  for (const m of dropped) {
    const { count, error } = await db
      .from("meeting_attendance")
      .select("*", { count: "exact", head: true })
      .eq("meeting_id", m.id);
    if (error) throw error;
    if ((count ?? 0) > 0) {
      kept += 1;
      continue;
    }
    const { error: delError } = await db.from("meetings").delete().eq("id", m.id);
    if (delError) throw delError;
    removed += 1;
  }

  console.log(
    `  ${added} added, ${updated} updated, ${removed} removed` +
      (kept > 0 ? `, ${kept} kept (attendance already recorded)` : "") +
      `\n  ${rows.length} dates on ${fund.name}'s calendar`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
