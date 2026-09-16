/**
 * Dumps the current academic year's roster for both funds to stdout in the
 * roster import format (SPEC 17.1), so it can be edited and fed straight back
 * into /[fund]/admin/members:
 *
 *   email,full_name,fund,role,sector,is_sector_leader,title_override
 *
 * Usage:
 *   npm run export-roster > roster-2026-27.csv
 *
 * The same export is available in the app at
 * GET /api/[fund]/roster/export (one fund at a time, officers only). This
 * script is the offline version: it uses the service role, so it does not need
 * anyone to be signed in, and it covers both funds in one file.
 *
 * Everything except the CSV goes to stderr, so redirecting stdout gives a
 * clean file.
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { toCsv } from "../src/lib/csv";
import type { MembershipRole, MembershipStatus } from "../src/types/domain";

loadEnv({ path: ".env.local", quiet: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Add it to .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

const db: SupabaseClient = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } }
);

interface MembershipRow {
  role: MembershipRole;
  is_sector_leader: boolean;
  status: MembershipStatus;
  title_override: string | null;
  profiles: { email: string; full_name: string } | null;
  funds: { slug: string } | null;
  sectors: { name: string } | null;
}

/** Officers first, then leaders, then everyone else — same as the app's list. */
const ROLE_ORDER: MembershipRole[] = [
  "president",
  "vice_president",
  "portfolio_manager",
  "alumni_relations",
  "sector_leader",
  "analyst",
  "viewer",
];

async function main(): Promise<void> {
  const yearResult = await db
    .from("academic_years")
    .select("id, label")
    .eq("is_current", true)
    .maybeSingle();
  if (yearResult.error) {
    throw new Error(`academic_years: ${yearResult.error.message}`);
  }
  const year = yearResult.data as { id: string; label: string } | null;
  if (!year) {
    throw new Error(
      "No current academic year. Run the seed or start a year in /[fund]/admin/year."
    );
  }

  const result = await db
    .from("memberships")
    .select(
      "role, is_sector_leader, status, title_override, profiles(email, full_name), funds(slug), sectors(name)"
    )
    .eq("academic_year_id", year.id);
  if (result.error) throw new Error(`memberships: ${result.error.message}`);

  // PostgREST returns a single object for each to-one embed; supabase-js types
  // them as arrays when the client has no generated Database type, so cast.
  const rows = (result.data as unknown as MembershipRow[] | null) ?? [];
  rows.sort((a, b) => {
    const fund = (a.funds?.slug ?? "").localeCompare(b.funds?.slug ?? "");
    if (fund !== 0) return fund;
    const role = ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role);
    if (role !== 0) return role;
    const sector = (a.sectors?.name ?? "").localeCompare(b.sectors?.name ?? "");
    if (sector !== 0) return sector;
    return (a.profiles?.full_name ?? "").localeCompare(b.profiles?.full_name ?? "");
  });

  const csv = toCsv(
    [
      "email",
      "full_name",
      "fund",
      "role",
      "sector",
      "is_sector_leader",
      "title_override",
    ],
    rows.map((m) => [
      m.profiles?.email ?? "",
      m.profiles?.full_name ?? "",
      m.funds?.slug ?? "",
      m.role,
      m.sectors?.name ?? "",
      m.is_sector_leader,
      m.title_override ?? "",
    ])
  );

  process.stdout.write(`${csv}\n`);
  const byFund = rows.reduce((counts, m) => {
    const slug = m.funds?.slug ?? "unknown";
    counts.set(slug, (counts.get(slug) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
  const breakdown = [...byFund]
    .map(([slug, count]) => `${slug} ${count}`)
    .join(", ");
  console.error(
    `Exported ${rows.length} memberships for ${year.label} (${breakdown}).`
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
