// POST /api/[fund]/snapshots/import — backfill historical fund values from a
// CSV (date,total_value,cash) so the performance chart extends back before
// launch (SPEC Section 14). Officer-gated.
//
// Three things this route has to get right, because fund_snapshots is the
// permanent record every performance number is computed from:
//
//   1. It fetches the benchmark's close for each imported date from Yahoo.
//      Without that the fund line would have nineteen years of history and
//      the benchmark line none, which is the comparison the page exists for.
//   2. It only ever inserts. fund_snapshots is immutable by design (SPEC
//      Section 9: update and delete are "never", and the RLS policies have no
//      update policy at all), so a date that already has a snapshot is
//      reported as skipped and left alone. Upserting would have failed on the
//      policy with an error meaning nothing to a student officer.
//   3. A date repeated inside one CSV is resolved before the insert, since
//      two rows for the same date would violate the primary key.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getFundContext } from "@/lib/fund";
import { isOfficer } from "@/lib/permissions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseCsv } from "@/lib/csv";
import {
  matchBenchmarkBars,
  parseSnapshotRows,
  type BenchmarkBar,
} from "@/lib/snapshots";
import { getDailyHistory } from "@/lib/yahoo";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ csv: z.string().min(1).max(500_000) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fund: string }> }
) {
  const { fund: slug } = await params;
  const ctx = await getFundContext(slug);
  if (!ctx) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(isOfficer(ctx) || ctx.isFacultyAdvisor || ctx.isAppAdmin)) {
    return NextResponse.json({ error: "Officers only." }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide the CSV text." }, { status: 400 });
  }

  const rows = parseCsv(parsed.data.csv);
  if (rows.length < 2) {
    return NextResponse.json(
      { error: "The CSV needs a header row and at least one data row." },
      { status: 400 }
    );
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const parsedRows = parseSnapshotRows(rows, header);
  if ("error" in parsedRows) {
    return NextResponse.json({ error: parsedRows.error }, { status: 400 });
  }
  const { rows: valid, errors, duplicateDates } = parsedRows;

  if (valid.length === 0) {
    return NextResponse.json(
      { imported: 0, skipped: 0, errors, error: "No valid rows to import." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const dates = valid.map((r) => r.date);

  // ── Skip dates that already have a snapshot ───────────────────────────────
  // Immutable by design, so this is a filter and not a conflict clause.
  const { data: existingRows, error: existingError } = await supabase
    .from("fund_snapshots")
    .select("snapshot_date")
    .eq("fund_id", ctx.fund.id)
    .gte("snapshot_date", dates[0])
    .lte("snapshot_date", dates[dates.length - 1]);
  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  const taken = new Set(
    ((existingRows as { snapshot_date: string }[]) ?? []).map((r) =>
      r.snapshot_date.slice(0, 10)
    )
  );
  const skipped = dates.filter((d) => taken.has(d));
  const toImport = dates.filter((d) => !taken.has(d));

  if (toImport.length === 0) {
    return NextResponse.json({
      imported: 0,
      skipped: skipped.length,
      skippedDates: skipped.slice(0, 20),
      errors,
      note: "Every date in this file already has a snapshot. Snapshots are a permanent record and are never overwritten, so nothing changed.",
    });
  }

  // ── Benchmark closes for the same dates ───────────────────────────────────
  // One Yahoo call covers the whole range. Weekends and holidays have no bar,
  // so each snapshot takes the last close on or before its date — the same
  // rule the EOD cron uses.
  let bars = new Map<string, BenchmarkBar>();
  let benchmarkNote: string | null = null;
  try {
    const from = new Date(`${toImport[0]}T00:00:00Z`);
    from.setUTCDate(from.getUTCDate() - 7); // reach back for the first date
    const history = await getDailyHistory(ctx.fund.benchmark_symbol, from);
    bars = new Map(
      history.map((h) => [
        h.time.slice(0, 10),
        { close: h.close, adj: h.adjClose },
      ])
    );
    if (bars.size === 0) {
      benchmarkNote = `Yahoo returned no ${ctx.fund.benchmark_symbol} history for this range; benchmark returns will be blank for these dates.`;
    }
  } catch (err) {
    benchmarkNote = `Could not reach Yahoo for ${ctx.fund.benchmark_symbol} (${
      err instanceof Error ? err.message : String(err)
    }); the fund values imported without benchmark closes.`;
  }
  const benchmarkByDate = matchBenchmarkBars(toImport, bars);

  const importSet = new Set(toImport);
  const toInsert = valid
    .filter((row) => importSet.has(row.date))
    .map((row) => {
      const date = row.date;
      const bench = benchmarkByDate.get(date) ?? null;
      return {
        fund_id: ctx.fund.id,
        snapshot_date: date,
        market_value: row.totalValue - row.cash,
        cash: row.cash,
        total_value: row.totalValue,
        benchmark_symbol: ctx.fund.benchmark_symbol,
        benchmark_close: bench?.close ?? null,
        benchmark_adj_close: bench?.adj ?? null,
        // The marker that lets a later import replace this row but not a
        // cron-written one.
        detail: { imported: true },
      };
    });

  const { error } = await supabase.from("fund_snapshots").insert(toInsert);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const withBenchmark = toInsert.filter(
    (u) => u.benchmark_close !== null
  ).length;

  await logAudit(supabase, {
    actorId: ctx.profile.id,
    fundId: ctx.fund.id,
    action: "snapshots.import",
    entity: "fund_snapshots",
    after: {
      imported: toInsert.length,
      skipped: skipped.length,
      failed: errors.length,
      with_benchmark: withBenchmark,
      from: toImport[0],
      to: toImport[toImport.length - 1],
    },
  });

  return NextResponse.json({
    imported: toInsert.length,
    withBenchmark,
    skipped: skipped.length,
    skippedDates: skipped.slice(0, 20),
    duplicateDates: duplicateDates.slice(0, 20),
    errors,
    ...(skipped.length > 0
      ? {
          skippedNote:
            "Those dates already had a snapshot. Snapshots are a permanent record and are never overwritten.",
        }
      : {}),
    ...(benchmarkNote ? { benchmarkNote } : {}),
  });
}
