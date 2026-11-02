/**
 * Take Athena live, once: clear the seed's demo records and replace the
 * placeholder performance history with the PM workbook's month-ends.
 *
 *   npm run athena-go-live -- path/to/athena.json            # preview, writes nothing
 *   npm run athena-go-live -- path/to/athena.json --apply    # write it
 *
 * Run it after `npm run import-athena -- path/to/athena.json --apply`, from
 * the same JSON (scripts/extract-athena-book.py writes both parts). It checks
 * that the real book is loaded and stops otherwise, because the placeholder
 * holdings it deletes are the ones that import closed.
 *
 * Demo records: pitches, tickets, trades and cash movements made by a demo
 * account (an @example.com address), trades the seed marked "Seed: ...", and
 * anything hanging off a demo pitch or ticket. Votes and pitch files go with
 * their pitch; the files are removed from storage too. Anything else is left
 * alone and listed, since the live site may already have real activity in it.
 * Placeholder holdings are deleted once nothing points at them.
 *
 * History: every Athena snapshot is replaced. The ones there now are the
 * seed's made-up series and nightly valuations of the placeholder book. The
 * workbook's month-ends go in the way the app's own history import writes
 * them, with the benchmark's close for each date from Yahoo (the workbook's
 * own S&P column drifts from April 2026 on). The nightly snapshot carries on
 * from the real book after that.
 *
 * Snapshots are otherwise a permanent record that nothing deletes, which is
 * why this is a one-time script and not part of the weekly import.
 */

import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getDailyHistory } from "../src/lib/yahoo";
import { matchBenchmarkBars, type BenchmarkBar } from "../src/lib/snapshots";
import { historySnapshots, planDemoCleanup, type Book, type DemoTables } from "./athena-book";

loadEnv({ path: ".env.local", quiet: true });

const FUND_SLUG = "athena";
const PITCH_BUCKET = "pitch-files";

function client(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (in .env.local or the environment)"
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/** .in() puts every id in the URL, so long lists go in batches. */
function chunks<T>(items: T[], size = 100): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function remove(db: SupabaseClient, table: string, ids: string[]) {
  for (const batch of chunks(ids)) {
    must(await db.from(table).delete().in("id", batch), `delete from ${table}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  if (!file) throw new Error("usage: npm run athena-go-live -- path/to/athena.json [--apply]");
  const book: Book = JSON.parse(readFileSync(file, "utf8"));
  const history = book.history ?? [];
  if (history.length === 0) {
    throw new Error("this JSON has no history; re-run scripts/extract-athena-book.py on the workbook");
  }
  if (!apply) console.log("PREVIEW: nothing is written without --apply\n");

  const db = client();
  const fund = must(
    await db.from("funds").select("id, name, benchmark_symbol").eq("slug", FUND_SLUG).single(),
    "fund"
  ) as { id: string; name: string; benchmark_symbol: string };

  const holdings = must(
    await db.from("holdings").select("id, symbol, name, is_active").eq("fund_id", fund.id),
    "holdings"
  ) as DemoTables["holdings"];

  // The real book has to be in first: the placeholders this deletes are the
  // ones that import closed.
  const want = new Set(book.positions.map((p) => p.symbol.toUpperCase()));
  const active = holdings.filter((h) => h.is_active);
  const stray = active.filter((h) => !want.has((h.symbol ?? "").toUpperCase()));
  const missing = [...want].filter(
    (s) => !active.some((h) => (h.symbol ?? "").toUpperCase() === s)
  );
  if (stray.length > 0 || missing.length > 0) {
    throw new Error(
      "The real book isn't loaded yet. Run `npm run import-athena -- <file> --apply` first." +
        (stray.length ? `\n  active but not in the workbook: ${stray.map((h) => h.symbol ?? h.name).join(", ")}` : "") +
        (missing.length ? `\n  in the workbook but not active: ${missing.join(", ")}` : "")
    );
  }

  const demoProfiles = must(
    await db.from("profiles").select("id, email").ilike("email", "%@example.com"),
    "demo profiles"
  ) as { id: string; email: string }[];
  const demoIds = new Set(demoProfiles.map((p) => p.id));

  const pitches = must(
    await db.from("pitches").select("id, author_id, title, holding_id").eq("fund_id", fund.id),
    "pitches"
  ) as (DemoTables["pitches"][number] & { holding_id: string | null })[];
  const tickets = must(
    await db.from("trade_tickets").select("id, created_by, pitch_id, holding_id").eq("fund_id", fund.id),
    "tickets"
  ) as (DemoTables["tickets"][number] & { holding_id: string | null })[];
  const trades = must(
    await db.from("trades").select("id, executed_by, ticket_id, notes, holding_id").eq("fund_id", fund.id),
    "trades"
  ) as (DemoTables["trades"][number] & { holding_id: string | null })[];
  const cash = must(
    await db.from("cash_movements").select("id, recorded_by, holding_id").eq("fund_id", fund.id),
    "cash movements"
  ) as DemoTables["cashMovements"];

  const marks: { holding_id: string }[] = [];
  for (const batch of chunks(holdings.map((h) => h.id))) {
    marks.push(
      ...(must(
        await db.from("bond_marks").select("holding_id").in("holding_id", batch),
        "bond marks"
      ) as { holding_id: string }[])
    );
  }

  const plan = planDemoCleanup(
    {
      pitches,
      tickets,
      trades,
      cashMovements: cash,
      holdings,
      otherHoldingRefs: marks.map((m) => m.holding_id),
      holdingRefs: [
        ...pitches.map((p) => ({ table: "pitches" as const, id: p.id, holding_id: p.holding_id })),
        ...tickets.map((k) => ({ table: "tickets" as const, id: k.id, holding_id: k.holding_id })),
        ...trades.map((r) => ({ table: "trades" as const, id: r.id, holding_id: r.holding_id })),
        ...cash.map((c) => ({ table: "cashMovements" as const, id: c.id, holding_id: c.holding_id })),
      ],
    },
    demoIds
  );

  const files: { storage_path: string }[] = [];
  for (const batch of chunks(plan.pitches)) {
    files.push(
      ...(must(
        await db.from("pitch_files").select("storage_path").in("pitch_id", batch),
        "pitch files"
      ) as { storage_path: string }[])
    );
  }
  let votes = 0;
  for (const batch of chunks(plan.pitches)) {
    const { count, error } = await db
      .from("votes")
      .select("id", { count: "exact", head: true })
      .in("pitch_id", batch);
    if (error) throw new Error(`votes: ${error.message}`);
    votes += count ?? 0;
  }

  console.log(`Demo records in ${fund.name} (${demoProfiles.length} demo accounts):`);
  console.log(`  ${plan.pitches.length} pitches, with ${votes} votes and ${files.length} files`);
  console.log(`  ${plan.tickets.length} trade tickets`);
  console.log(`  ${plan.trades.length} trades`);
  console.log(`  ${plan.cashMovements.length} cash movements`);
  const placeholderNames = holdings
    .filter((h) => plan.holdings.includes(h.id))
    .map((h) => h.symbol ?? h.name);
  console.log(
    `  ${plan.holdings.length} closed placeholder holdings: ${placeholderNames.join(", ") || "none"}`
  );
  if (plan.kept.length > 0) {
    console.log(`Not demo, left in place (${plan.kept.length}):`);
    for (const k of plan.kept) console.log(`  ${k.table} ${k.id} ${k.label}`);
  }

  // Benchmark closes for each month-end, the same way the app's own history
  // import and the nightly snapshot get them.
  const from = new Date(`${history[0].date}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 7);
  const bars = new Map<string, BenchmarkBar>(
    (await getDailyHistory(fund.benchmark_symbol, from)).map((h) => [
      h.time.slice(0, 10),
      { close: h.close, adj: h.adjClose ?? null },
    ])
  );
  const bench = matchBenchmarkBars(
    history.map((h) => h.date),
    bars
  );
  const rows = historySnapshots(fund.id, fund.benchmark_symbol, history, bench);
  const unmatched = rows.filter((r) => r.benchmark_close === null).map((r) => r.snapshot_date);

  const { count: snapshotCount } = await db
    .from("fund_snapshots")
    .select("id", { count: "exact", head: true })
    .eq("fund_id", fund.id);
  console.log(
    `\nHistory: ${snapshotCount ?? 0} placeholder snapshots out, ${rows.length} month-ends in` +
      ` (${history[0].date} to ${history.at(-1)?.date}),` +
      ` ${rows.length - unmatched.length} with a ${fund.benchmark_symbol} close` +
      (unmatched.length ? `; no close for ${unmatched.join(", ")}` : "")
  );

  if (!apply) {
    console.log("\nPreview only. Re-run with --apply to write this.");
    return;
  }

  // Children before parents: a trade can point at a ticket, a ticket at a
  // pitch, and all of them at a holding.
  await remove(db, "trades", plan.trades);
  await remove(db, "trade_tickets", plan.tickets);
  if (files.length > 0) {
    const { error } = await db.storage.from(PITCH_BUCKET).remove(files.map((f) => f.storage_path));
    if (error) throw new Error(`remove pitch files: ${error.message}`);
  }
  await remove(db, "pitches", plan.pitches); // votes and file rows cascade
  await remove(db, "cash_movements", plan.cashMovements);
  await remove(db, "holdings", plan.holdings);

  must(await db.from("fund_snapshots").delete().eq("fund_id", fund.id), "clear snapshots");
  for (const batch of chunks(rows)) {
    must(await db.from("fund_snapshots").insert(batch), "insert snapshots");
  }

  const { data: admin } = await db
    .from("profiles")
    .select("id")
    .eq("is_app_admin", true)
    .limit(1)
    .maybeSingle();
  must(
    await db.from("audit_log").insert([
      {
        actor_id: admin?.id ?? null,
        fund_id: fund.id,
        action: "demo.clear",
        entity: "fund",
        entity_id: fund.id,
        after: {
          pitches: plan.pitches.length,
          votes,
          files: files.length,
          tickets: plan.tickets.length,
          trades: plan.trades.length,
          cash_movements: plan.cashMovements.length,
          holdings: plan.holdings.length,
        },
      },
      {
        actor_id: admin?.id ?? null,
        fund_id: fund.id,
        action: "snapshots.import",
        entity: "fund_snapshots",
        entity_id: null,
        before: { snapshots: snapshotCount ?? 0 },
        after: {
          snapshots: rows.length,
          from: history[0].date,
          to: history.at(-1)?.date,
          source: "FactSet holdings workbook, 'Tracking Error' (replaced the placeholder history)",
        },
      },
    ]),
    "audit log"
  );

  console.log(
    `\nDone: ${plan.pitches.length} pitches, ${plan.tickets.length} tickets, ${plan.trades.length} trades,` +
      ` ${plan.cashMovements.length} cash movements and ${plan.holdings.length} placeholder holdings removed;` +
      ` ${rows.length} month-ends of history in.`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
