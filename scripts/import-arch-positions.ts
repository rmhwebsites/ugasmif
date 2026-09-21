/**
 * Load the Arch Bond Fund's real positions from the PM workbook export.
 *
 *   npm run import-arch -- path/to/positions.json
 *
 * The PM keeps the book in Excel, where most live-price cells read #NAME?
 * without their market-data add-in. Every static field — cusip, dates,
 * quantity, price paid, coupon, duration, rating — is a stored value, so the
 * positions are fully recoverable from the file even on a machine that cannot
 * evaluate those formulas. A small extractor turns the workbook into the JSON
 * this script reads; see HANDOVER.md.
 *
 * The positions file is NOT in the repo. It is a real portfolio and this
 * repository is public, so it stays on the operator's machine and is passed in
 * by path.
 *
 * Replaces the fund's holdings wholesale rather than merging: the workbook is
 * the book of record, and a position missing from it has been sold. Runs in
 * one pass so a failure part-way leaves the old set intact.
 */

import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

loadEnv({ path: ".env.local", quiet: true });

const FUND_SLUG = "arch";

interface Position {
  instrument_type: "treasury" | "corporate" | "agency_mbs" | "municipal" | "etf" | "money_market";
  sector: string | null;
  symbol: string | null;
  cusip: string | null;
  name: string;
  quantity: number;
  avg_cost: number;
  coupon_rate: number | null;
  maturity_date: string | null;
  issue_date: string | null;
  opened_on: string | null;
  rating: string | null;
  duration: number | null;
  ytm: number | null;
  inflation_factor: number | null;
  issuer?: string | null;
  notes?: string | null;
  src: string;
}

const BOND_TYPES = new Set(["treasury", "corporate", "agency_mbs", "municipal"]);

/**
 * How each instrument gets priced (SPEC 13.2):
 *  - Treasuries, TIPS and STRIPS off the live Treasury curve
 *  - corporates and agencies off a PM mark; with no mark yet they show at cost
 *    and are flagged stale, which is what the marks checklist is for
 *  - ETFs quote live, and the sweep prices at par
 */
function pricingMethod(p: Position): "live" | "treasury_curve" | "manual" {
  if (p.instrument_type === "etf" || p.instrument_type === "money_market") return "live";
  // TIPS quote off a REAL yield curve. We only carry the nominal one, and
  // running a 0.75% 2042 TIPS through it marks it at 53 when it cost 78.65 —
  // confidently wrong is worse than plainly unpriced, so these wait for a
  // PM mark like the corporates do. inflation_factor is set only on TIPS.
  if (p.inflation_factor !== null && p.inflation_factor !== 1) return "manual";
  if (p.instrument_type === "treasury") return "treasury_curve";
  return "manual";
}

/** Years to maturity, for picking the curve point a mark drifts against. */
function benchmarkTenor(p: Position): number | null {
  if (!BOND_TYPES.has(p.instrument_type) || !p.maturity_date) return null;
  const years =
    (Date.parse(p.maturity_date) - Date.parse(p.opened_on ?? p.maturity_date)) /
    (365.25 * 24 * 3600 * 1000);
  // Snap to the tenors the Treasury publishes, so the drift has a real point.
  const TENORS = [0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30];
  return TENORS.reduce((best, t) =>
    Math.abs(t - years) < Math.abs(best - years) ? t : best
  );
}

function dayCount(p: Position): string | null {
  if (!BOND_TYPES.has(p.instrument_type)) return null;
  // Treasuries accrue actual/actual; corporates and agencies 30/360.
  return p.instrument_type === "treasury" ? "ACT/ACT" : "30/360";
}

function paymentFrequency(p: Position): number | null {
  if (!BOND_TYPES.has(p.instrument_type)) return null;
  // Semi-annual for everything, including the strips: a 0% coupon already
  // says nothing is paid, and src/lib/bonds/accrued.ts overrides a 0 here
  // back to 2 anyway, so storing 0 would only look like it meant something.
  return 2;
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
  const file = process.argv[2];
  if (!file) throw new Error("usage: npm run import-arch -- path/to/positions.json");
  const positions: Position[] = JSON.parse(readFileSync(file, "utf8"));
  console.log(`${positions.length} positions in ${file}`);

  const db = client();
  const { data: fund, error: fundError } = await db
    .from("funds")
    .select("id, name")
    .eq("slug", FUND_SLUG)
    .single();
  if (fundError || !fund) throw fundError ?? new Error("Arch fund not found");

  // Sectors: match on name, creating any the workbook uses that the fund does
  // not have yet (it tracks a mortgage sleeve the seed never had).
  const { data: existing } = await db
    .from("sectors")
    .select("id, name, sort_order")
    .eq("fund_id", fund.id);
  const byName = new Map((existing ?? []).map((s) => [s.name.toLowerCase(), s.id]));
  const wanted = [...new Set(positions.map((p) => p.sector).filter(Boolean))] as string[];
  let nextOrder =
    Math.max(0, ...(existing ?? []).map((s) => Number(s.sort_order) || 0)) + 1;

  for (const name of wanted) {
    if (byName.has(name.toLowerCase())) continue;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { data, error } = await db
      .from("sectors")
      .insert({ fund_id: fund.id, name, slug, sort_order: nextOrder++ })
      .select("id")
      .single();
    if (error) throw error;
    byName.set(name.toLowerCase(), data.id);
    console.log(`  created sector ${name}`);
  }

  const rows = positions.map((p) => ({
    fund_id: fund.id,
    sector_id: p.sector ? byName.get(p.sector.toLowerCase()) ?? null : null,
    instrument_type: p.instrument_type,
    symbol: p.symbol,
    cusip: p.cusip,
    name: p.name,
    issuer: p.issuer ?? null,
    quantity: p.quantity,
    avg_cost: p.avg_cost,
    coupon_rate: p.coupon_rate,
    maturity_date: p.maturity_date,
    issue_date: p.issue_date,
    opened_on: p.opened_on,
    rating: p.rating,
    duration: p.duration,
    ytm: p.ytm,
    day_count: dayCount(p),
    payment_frequency: paymentFrequency(p),
    pricing_method: pricingMethod(p),
    benchmark_tenor: benchmarkTenor(p),
    is_active: true,
    notes: p.notes ?? null,
  }));

  // Everything the workbook does not list has been sold.
  const { error: clearError } = await db
    .from("holdings")
    .delete()
    .eq("fund_id", fund.id);
  if (clearError) throw clearError;

  const { error: insertError } = await db.from("holdings").insert(rows);
  if (insertError) throw insertError;

  const bonds = rows.filter((r) => BOND_TYPES.has(r.instrument_type));
  const cost = positions.reduce(
    (s, p) =>
      s + (BOND_TYPES.has(p.instrument_type) ? (p.quantity * p.avg_cost) / 100 : p.quantity * p.avg_cost),
    0
  );
  console.log(
    `\n  ${rows.length} positions into ${fund.name}` +
      `\n  ${bonds.length} individual bonds, ${rows.length - bonds.length} funds and cash` +
      `\n  cost basis $${cost.toLocaleString("en-US", { maximumFractionDigits: 0 })}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
