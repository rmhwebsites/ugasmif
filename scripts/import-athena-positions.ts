/**
 * Load the Athena Stock Fund's real book from the FactSet holdings workbook.
 *
 *   npm run import-athena -- path/to/athena.json            # preview, writes nothing
 *   npm run import-athena -- path/to/athena.json --apply    # write it
 *   ... --apply --no-targets                                  # holdings and cash only
 *
 * The PM keeps the book in a FactSet-linked workbook ('Holdings Update'). A
 * small extractor (scripts/extract-athena-book.py) turns that sheet into the
 * JSON this script reads: every position (ticker, sector, buy date, cost per
 * share, shares), the cash line, and the sector table beside it (S&P weight
 * and the Equity Strategies team's tilt for each sector). The sheet carries
 * tickers only, so a ticker the fund already holds keeps its row's name and
 * type, and a new one takes them from its Yahoo quote. See HANDOVER.md.
 *
 * The JSON is NOT in the repo. It is a real portfolio and this repository is
 * public, so it stays on the operator's machine and is passed in by path.
 *
 * The workbook is the book of record. Positions are matched on ticker and
 * updated IN PLACE, keeping their id, so trades, tickets and pitches that
 * point at a holding keep pointing at it. Anything the workbook doesn't list
 * is closed, not deleted, so its history survives. Running it twice changes
 * nothing the second time.
 *
 * It runs as a preview unless --apply is passed: the preview prints exactly
 * what would change, which is worth reading before writing to a live fund.
 */

import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";
import {
  checkBook,
  money,
  planImport,
  resolveIdentity,
  type Book,
  type ExistingHolding,
  type QuoteIdentity,
} from "./athena-book";

loadEnv({ path: ".env.local", quiet: true });

const FUND_SLUG = "athena";

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

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  const withTargets = !args.includes("--no-targets");
  if (!file) {
    throw new Error("usage: npm run import-athena -- path/to/athena.json [--apply] [--no-targets]");
  }
  const book: Book = JSON.parse(readFileSync(file, "utf8"));
  checkBook(book);
  console.log(
    `${book.positions.length} positions and ${money(book.cash)} cash as of ${book.as_of}` +
      ` (${money(book.sheet_total)} in the workbook)` +
      (apply ? "" : "\nPREVIEW: nothing is written without --apply")
  );

  const db = client();
  const { data: fund, error: fundError } = await db
    .from("funds")
    .select("id, name, cash_balance")
    .eq("slug", FUND_SLUG)
    .single();
  if (fundError || !fund) throw fundError ?? new Error("Athena fund not found");

  // Sectors are matched on name and must already exist: a name that doesn't
  // match is a mapping mistake in the extractor, not a new sector to create.
  const { data: sectors, error: sectorsError } = await db
    .from("sectors")
    .select("id, name")
    .eq("fund_id", fund.id);
  if (sectorsError) throw sectorsError;
  const sectorId = new Map((sectors ?? []).map((s) => [s.name.toLowerCase(), s.id as string]));
  const unknown = [
    ...new Set([...book.positions.map((p) => p.sector), ...book.sector_targets.map((t) => t.name)]),
  ].filter((n) => !sectorId.has(n.toLowerCase()));
  if (unknown.length > 0) throw new Error(`no Athena sector named: ${unknown.join(", ")}`);

  const { data: current, error: currentError } = await db
    .from("holdings")
    .select("id, symbol, name, instrument_type, quantity, avg_cost, opened_on, sector_id, is_active")
    .eq("fund_id", fund.id);
  if (currentError) throw currentError;
  const existing = (current ?? []) as ExistingHolding[];

  // Names and types for tickers the fund doesn't hold yet come from Yahoo.
  const held = new Set(existing.map((h) => (h.symbol ?? "").toUpperCase()));
  const lookup = book.positions
    .filter((p) => (!p.name || !p.instrument_type) && !held.has(p.symbol.toUpperCase()))
    .map((p) => p.symbol.toUpperCase());
  const quotes = new Map<string, QuoteIdentity>();
  if (lookup.length > 0) {
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const found = (await yf.quote(lookup, {}, { validateResult: false })) as unknown as {
      symbol: string;
      longName?: string;
      shortName?: string;
      quoteType?: string;
    }[];
    for (const q of found) {
      quotes.set(q.symbol.toUpperCase(), {
        name: q.longName ?? q.shortName ?? null,
        quoteType: q.quoteType ?? null,
      });
    }
  }
  book.positions = resolveIdentity(book.positions, existing, quotes);

  const plan = planImport(book, existing, fund.id, sectorId);

  console.log(
    `\n${plan.updates.length} matched positions change, ${plan.unchanged} already match:`
  );
  for (const { row, was } of plan.updates) {
    console.log(
      `  ${row.symbol.padEnd(6)} ${was.is_active ? "" : "(reopened) "}` +
        `${Number(was.quantity)} @ ${Number(was.avg_cost).toFixed(2)} -> ${row.quantity} @ ${row.avg_cost.toFixed(2)}`
    );
  }
  console.log(`${plan.inserts.length} new: ${plan.inserts.map((r) => r.symbol).join(", ") || "none"}`);
  console.log(
    `${plan.close.length} closed: ${plan.close.map((h) => h.symbol ?? h.name).join(", ") || "none"}`
  );
  console.log(`cash ${money(Number(fund.cash_balance ?? 0))} -> ${money(book.cash)}`);

  const { data: admin } = await db
    .from("profiles")
    .select("id")
    .eq("is_app_admin", true)
    .limit(1)
    .maybeSingle();
  const targetRows = withTargets
    ? book.sector_targets.map((t) => ({
        fund_id: fund.id,
        sector_id: sectorId.get(t.name.toLowerCase()) as string,
        target_weight_pct: t.target_weight_pct,
        benchmark_weight_pct: t.benchmark_weight_pct,
        effective_on: book.as_of,
        set_by: admin?.id ?? null,
        notes:
          `S&P weight ${t.benchmark_weight_pct}% ${t.tilt_pct >= 0 ? "+" : ""}${t.tilt_pct}%` +
          " Equity Strategies tilt, from the FactSet holdings workbook",
      }))
    : [];
  if (withTargets) {
    console.log(`${targetRows.length} sector targets effective ${book.as_of}:`);
    for (const t of book.sector_targets) {
      console.log(`  ${t.name.padEnd(30)} target ${t.target_weight_pct}%  S&P ${t.benchmark_weight_pct}%`);
    }
  }

  const cost = book.positions.reduce((s, p) => s + p.quantity * p.avg_cost, 0);
  console.log(`cost basis ${money(cost)}`);

  if (!apply) {
    console.log("\nPreview only. Re-run with --apply to write this.");
    return;
  }

  for (const { id, row } of plan.updates) {
    const { error } = await db.from("holdings").update(row).eq("id", id);
    if (error) throw error;
  }
  if (plan.inserts.length > 0) {
    const { error } = await db.from("holdings").insert(plan.inserts);
    if (error) throw error;
  }
  if (plan.close.length > 0) {
    const { error } = await db
      .from("holdings")
      .update({ is_active: false, closed_on: book.as_of })
      .in("id", plan.close.map((h) => h.id));
    if (error) throw error;
  }
  if (Number(fund.cash_balance ?? 0) !== book.cash) {
    const { error } = await db.from("funds").update({ cash_balance: book.cash }).eq("id", fund.id);
    if (error) throw error;
  }
  if (targetRows.length > 0) {
    // One row per sector per date, so re-running the same workbook replaces
    // its own targets instead of stacking a second set.
    const { error } = await db
      .from("sector_targets")
      .upsert(targetRows, { onConflict: "sector_id,effective_on" });
    if (error) throw error;
  }

  // One entry in the fund's audit log, so officers can see when the book was
  // reloaded and from what.
  const { error: auditError } = await db.from("audit_log").insert({
    actor_id: admin?.id ?? null,
    fund_id: fund.id,
    action: "holdings.import",
    entity: "holdings",
    entity_id: null,
    before: {
      active: existing.filter((h) => h.is_active).length,
      cash: Number(fund.cash_balance ?? 0),
    },
    after: {
      as_of: book.as_of,
      positions: book.positions.length,
      updated: plan.updates.length,
      added: plan.inserts.length,
      closed: plan.close.length,
      cash: book.cash,
      sector_targets: targetRows.length,
      source: "FactSet holdings workbook",
    },
  });
  if (auditError) throw auditError;

  console.log(
    `\nWrote ${plan.updates.length} updated, ${plan.inserts.length} new, ${plan.close.length} closed,` +
      ` cash ${money(book.cash)}${targetRows.length ? `, ${targetRows.length} sector targets` : ""}.`
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
