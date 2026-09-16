/**
 * SMIF Hub seed data (SPEC Section 18). Run with `npm run seed`.
 *
 * Creates both funds, the 2026-27 academic year, the sectors, placeholder
 * users and memberships, the Athena and Arch holdings, bond marks, 30 days of
 * treasury curve, a few historical trades and a handful of pitches and votes.
 *
 * Real securities, fake amounts, fake people. Every name here is obviously a
 * placeholder ("Athena Healthcare Leader"); the real roster arrives through
 * the roster import (SPEC 17.1). Coupons, maturities and CUSIPs on the Arch
 * bonds are placeholders the Arch PM replaces on day one.
 *
 * Idempotent: rerunning upserts the same rows rather than duplicating them.
 * It also resets seeded quantities, fund settings, cash balances and the
 * global flags on the seeded profiles back to the seed values, so do not run
 * it against a fund that holds real positions.
 *
 * This script runs outside Next, so it builds its own service-role client
 * instead of importing @/lib/supabase/service (which is server-only and
 * guarded by tests/service-role-guard.test.ts).
 */

import { config as loadEnv } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import YahooFinance from "yahoo-finance2";
import { fetchTreasuryCurve } from "../src/lib/bonds/treasury";
import type {
  DayCount,
  FundSlug,
  InstrumentType,
  MembershipRole,
  PricingMethod,
  TreasuryCurvePoint,
} from "../src/types/domain";

loadEnv({ path: ".env.local", quiet: true });

// ── Constants ───────────────────────────────────────────────────────────────

const DEMO_PASSWORD = "smif-demo-2026!";
const YEAR_LABEL = "2026-27";
const YEAR_START = "2026-08-01";
const YEAR_END = "2027-07-31";
const ATHENA_TOTAL = 4_500_000;
const ARCH_TOTAL = 2_000_000;
const PLACEHOLDER_DOMAIN = "example.com";
const ALLOWED_DOMAINS = ["uga.edu", PLACEHOLDER_DOMAIN, "rmh.productions"];
/** Everything seeded before today's session; the ledger rows sit in Q3 2024. */
const DEFAULT_OPENED_ON = "2023-09-06";

const ADMIN_EMAIL =
  (process.env.BOOTSTRAP_ADMIN_EMAILS ?? "ryan@rmh.productions")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean)[0] ?? "ryan@rmh.productions";
const ADVISOR_EMAIL = `advisor@${PLACEHOLDER_DOMAIN}`;

// ── Small utilities ─────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `Missing ${name}. Add it to .env.local (see .env.example) and rerun.`
    );
    process.exit(1);
  }
  return value;
}

/** FNV-1a, so a symbol always produces the same stream. */
function seedFrom(key: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** mulberry32 — deterministic PRNG so reruns produce identical numbers. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** One stable number in [0,1) for a key. */
function rand(key: string): number {
  return mulberry32(seedFrom(key))();
}

/** One stable number in [min,max). */
function randBetween(key: string, min: number, max: number): number {
  return min + rand(key) * (max - min);
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** Most recent Friday strictly before today, at 21:00 UTC (US close). */
function lastFriday(): Date {
  const d = new Date();
  d.setUTCHours(21, 0, 0, 0);
  do {
    d.setUTCDate(d.getUTCDate() - 1);
  } while (d.getUTCDay() !== 5);
  return d;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/** Throws with context on a PostgREST error so the phase's catch can log it. */
function must<T>(result: QueryResult<T>, what: string): T {
  check(result, what);
  if (result.data === null) throw new Error(`${what}: no rows returned`);
  return result.data;
}

/** Same, for writes that do not ask for rows back (data is null on success). */
function check(result: { error: { message: string } | null }, what: string): void {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
}

/**
 * CUSIP check digit (modulus 10 double-add-double) so the placeholder CUSIPs
 * are well formed. Bases start with Z, which is not an assigned issuer prefix.
 */
function cusip(base8: string): string {
  if (base8.length !== 8) throw new Error(`cusip base must be 8 chars: ${base8}`);
  let sum = 0;
  for (let i = 0; i < 8; i += 1) {
    const c = base8[i];
    let v: number;
    if (c >= "0" && c <= "9") v = c.charCodeAt(0) - 48;
    else if (c >= "A" && c <= "Z") v = c.charCodeAt(0) - 55; // A = 10
    else throw new Error(`cusip base must be A-Z0-9: ${base8}`);
    if (i % 2 === 1) v *= 2;
    sum += Math.floor(v / 10) + (v % 10);
  }
  return `${base8}${(10 - (sum % 10)) % 10}`;
}

// ── Supabase (service role: this script bypasses RLS on purpose) ────────────

const db: SupabaseClient = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// ── Market data ─────────────────────────────────────────────────────────────

/**
 * Last-resort prices, used only when Yahoo is unreachable at seed time. They
 * are round numbers in the right neighbourhood, not quotes.
 */
const FALLBACK_PRICES: Record<string, number> = {
  AVGO: 340, ANET: 130, NOW: 1000, CRM: 280, FTNT: 95, XLK: 265,
  MCO: 500, AON: 360, XLF: 52,
  HCA: 400, ZTS: 165, AZN: 80, LH: 250, STE: 245, FTRE: 12,
  META: 700, CMCSA: 35, MSGS: 210,
  GD: 310, RTX: 155, DE: 480, WM: 220, BLDR: 130, XLI: 145,
  MCD: 300, SBUX: 95, LEN: 130, XLY: 230,
  WMT: 100, MDLZ: 65, DG: 90,
  NEE: 80, XLE: 88,
  MLM: 560, OHI: 40, WPC: 62,
  AGG: 100, SPY: 660,
};

interface QuoteLike {
  symbol: string;
  regularMarketPrice: number;
}

function asQuoteLike(value: unknown): QuoteLike | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const symbol = record.symbol;
  const price = record.regularMarketPrice;
  if (typeof symbol !== "string") return null;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) return null;
  return { symbol, regularMarketPrice: price };
}

/** One batched quote call; falls back to FALLBACK_PRICES for anything missing. */
async function getPrices(symbols: string[]): Promise<Map<string, number>> {
  const prices = new Map<string, number>();
  try {
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const response: unknown = await yf.quote(symbols);
    for (const row of Array.isArray(response) ? response : [response]) {
      const quote = asQuoteLike(row);
      if (quote) prices.set(quote.symbol.toUpperCase(), quote.regularMarketPrice);
    }
    console.log(`  prices: ${prices.size}/${symbols.length} live from Yahoo`);
  } catch (err) {
    console.warn(`  prices: Yahoo unavailable (${describe(err)}), using fallbacks`);
  }
  for (const symbol of symbols) {
    if (!prices.has(symbol)) {
      const fallback = FALLBACK_PRICES[symbol];
      if (fallback === undefined) {
        throw new Error(`No live price and no fallback price for ${symbol}`);
      }
      prices.set(symbol, fallback);
    }
  }
  return prices;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ── Seed tables ─────────────────────────────────────────────────────────────

interface FundSeed {
  slug: FundSlug;
  name: string;
  asset_class: "equity" | "fixed_income";
  benchmark_symbol: string;
  benchmark_name: string;
  meeting_day: number;
  inception_date: string | null;
  settings: Record<string, unknown>;
}

const FUNDS: FundSeed[] = [
  {
    slug: "athena",
    name: "Athena Stock Fund",
    asset_class: "equity",
    benchmark_symbol: "SPY",
    benchmark_name: "S&P 500",
    meeting_day: 3, // Wednesday
    inception_date: null,
    settings: {
      sector_can_vote_on_own_pitch: true,
      alumni_can_view_current: true,
      auto_open_votes: false,
    },
  },
  {
    slug: "arch",
    name: "Arch Bond Fund",
    asset_class: "fixed_income",
    benchmark_symbol: "AGG",
    benchmark_name: "Bloomberg US Aggregate",
    meeting_day: 1, // Monday
    inception_date: "2025-09-01", // started active trading Fall 2025
    settings: {
      sector_can_vote_on_own_pitch: true,
      alumni_can_view_current: true,
      auto_open_votes: false,
      stale_mark_days: 7,
    },
  },
];

const SECTORS: Record<FundSlug, string[]> = {
  athena: [
    "Equity Strategies",
    "Communication Services",
    "Consumer Discretionary",
    "Energy & Utilities",
    "Financial Institutions Group",
    "Healthcare",
    "Industrials",
    "REITs & Materials",
    "Staples",
    "Technology",
  ],
  arch: [
    "Macro",
    "Treasuries",
    "Financials",
    "Industrials",
    "Utilities",
    "Tactical Opportunities",
  ],
};

const STRATEGY_TEAM: Record<FundSlug, string> = {
  athena: "Equity Strategies",
  arch: "Macro",
};

interface EquitySeed {
  sector: string;
  symbol: string;
  name: string;
  weight: number;
  instrument_type: InstrumentType;
  opened_on?: string;
}

const ETF_SYMBOLS = new Set(["XLK", "XLF", "XLY", "XLE", "XLI", "AGG"]);

function equity(sector: string, symbol: string, name: string, weight: number): EquitySeed {
  return {
    sector,
    symbol,
    name,
    weight,
    instrument_type: ETF_SYMBOLS.has(symbol) ? "etf" : "equity",
  };
}

/** SPEC 18, Athena holdings. Weights sum to 100 including the 0.5 cash row. */
const ATHENA_HOLDINGS: EquitySeed[] = [
  equity("Technology", "AVGO", "Broadcom", 8.0),
  equity("Technology", "ANET", "Arista Networks", 6.0),
  equity("Technology", "NOW", "ServiceNow", 5.0),
  equity("Technology", "CRM", "Salesforce", 5.0),
  equity("Technology", "FTNT", "Fortinet", 4.0),
  equity("Technology", "XLK", "Technology Select Sector SPDR (placeholder)", 2.7),
  equity("Financial Institutions Group", "MCO", "Moody's", 4.5),
  equity("Financial Institutions Group", "AON", "Aon", 4.0),
  equity("Financial Institutions Group", "XLF", "Financial Select Sector SPDR (placeholder)", 4.0),
  equity("Healthcare", "HCA", "HCA Healthcare", 3.0),
  equity("Healthcare", "ZTS", "Zoetis", 2.5),
  equity("Healthcare", "AZN", "AstraZeneca", 2.5),
  equity("Healthcare", "LH", "Labcorp", 1.8),
  equity("Healthcare", "STE", "Steris", 1.5),
  equity("Healthcare", "FTRE", "Fortrea", 1.0),
  equity("Communication Services", "META", "Meta Platforms", 5.5),
  equity("Communication Services", "CMCSA", "Comcast", 2.5),
  equity("Communication Services", "MSGS", "Madison Square Garden Sports", 2.0),
  { ...equity("Industrials", "GD", "General Dynamics", 2.5), opened_on: "2024-08-15" },
  equity("Industrials", "RTX", "RTX", 2.0),
  equity("Industrials", "DE", "Deere", 1.8),
  equity("Industrials", "WM", "Waste Management", 1.5),
  equity("Industrials", "BLDR", "Builders FirstSource", 1.0),
  equity("Consumer Discretionary", "MCD", "McDonald's", 3.0),
  equity("Consumer Discretionary", "SBUX", "Starbucks", 2.0),
  equity("Consumer Discretionary", "LEN", "Lennar", 2.0),
  equity("Consumer Discretionary", "XLY", "Consumer Discretionary Select Sector SPDR (placeholder)", 1.3),
  equity("Staples", "WMT", "Walmart", 3.0),
  equity("Staples", "MDLZ", "Mondelez", 2.2),
  equity("Staples", "DG", "Dollar General", 1.7),
  equity("Energy & Utilities", "NEE", "NextEra Energy", 2.5),
  equity("Energy & Utilities", "XLE", "Energy Select Sector SPDR (placeholder)", 2.5),
  equity("REITs & Materials", "MLM", "Martin Marietta Materials", 2.0),
  { ...equity("REITs & Materials", "OHI", "Omega Healthcare Investors", 1.5), opened_on: "2024-09-12" },
  equity("REITs & Materials", "WPC", "W. P. Carey", 1.5),
];
const ATHENA_CASH_WEIGHT = 0.5;

/** Sold out of in Q3 2024 to fund the General Dynamics buy; kept for the ledger. */
const ATHENA_CLOSED_HOLDING: EquitySeed & { closed_on: string } = {
  ...equity("Industrials", "XLI", "Industrial Select Sector SPDR (placeholder)", 0),
  opened_on: "2022-09-07",
  closed_on: "2024-08-15",
};

interface BondSeed {
  sector: string | null;
  name: string;
  issuer: string | null;
  instrument_type: InstrumentType;
  pricing_method: PricingMethod;
  weight: number;
  symbol?: string;
  cusip?: string;
  coupon_rate?: number;
  maturity_date?: string;
  issue_date?: string;
  payment_frequency?: number;
  day_count?: DayCount;
  rating?: string;
  benchmark_tenor?: number;
  notes?: string;
}

/**
 * SPEC 18, Arch holdings. Issuers are real; coupons, maturities and CUSIPs are
 * placeholders. Day counts follow market convention: ACT/ACT for Treasuries,
 * 30/360 for corporates and the pass-throughs, ACT/360 for the sweep.
 */
const ARCH_HOLDINGS: BondSeed[] = [
  {
    sector: "Macro",
    name: "iShares Core U.S. Aggregate Bond ETF",
    issuer: "BlackRock",
    instrument_type: "etf",
    pricing_method: "live",
    symbol: "AGG",
    weight: 59.7,
  },
  {
    sector: "Macro",
    name: "UMBS 30-year 5.5% pool (placeholder pool)",
    issuer: "Fannie Mae",
    instrument_type: "agency_mbs",
    pricing_method: "manual",
    weight: 10.0,
    cusip: cusip("ZUMBS550"),
    coupon_rate: 5.5,
    issue_date: "2024-11-01",
    maturity_date: "2035-11-01",
    payment_frequency: 12,
    day_count: "30/360",
    rating: "AA+",
    benchmark_tenor: 7,
    notes: "Placeholder pool. Maturity stands in for weighted average life; replace with the real pool.",
  },
  {
    sector: "Macro",
    name: "GNMA II 30-year 5.0% pool (placeholder pool)",
    issuer: "Ginnie Mae",
    instrument_type: "agency_mbs",
    pricing_method: "manual",
    weight: 7.0,
    cusip: cusip("ZGNM2500"),
    coupon_rate: 5.0,
    issue_date: "2024-05-01",
    maturity_date: "2035-05-01",
    payment_frequency: 12,
    day_count: "30/360",
    rating: "AA+",
    benchmark_tenor: 7,
    notes: "Placeholder pool. Maturity stands in for weighted average life; replace with the real pool.",
  },
  {
    sector: "Treasuries",
    name: "US Treasury 10-year note (placeholder issue)",
    issuer: "US Treasury",
    instrument_type: "treasury",
    pricing_method: "treasury_curve",
    weight: 5.0,
    cusip: cusip("ZUST10A1"),
    coupon_rate: 4.25,
    issue_date: "2025-08-15",
    maturity_date: "2035-08-15",
    payment_frequency: 2,
    day_count: "ACT/ACT",
    rating: "AA+",
    notes: "Placeholder issue; priced off the daily par curve.",
  },
  {
    sector: "Treasuries",
    name: "US Treasury 2-year note (placeholder issue)",
    issuer: "US Treasury",
    instrument_type: "treasury",
    pricing_method: "treasury_curve",
    weight: 2.8,
    cusip: cusip("ZUST02A2"),
    coupon_rate: 4.0,
    issue_date: "2025-09-30",
    maturity_date: "2027-09-30",
    payment_frequency: 2,
    day_count: "ACT/ACT",
    rating: "AA+",
    notes: "Placeholder issue; priced off the daily par curve.",
  },
  {
    sector: "Utilities",
    name: "Duke Energy senior note (placeholder terms)",
    issuer: "Duke Energy Corp",
    instrument_type: "corporate",
    pricing_method: "manual",
    weight: 5.0,
    cusip: cusip("ZDUKE0A1"),
    coupon_rate: 5.1,
    issue_date: "2024-06-01",
    maturity_date: "2034-06-01",
    payment_frequency: 2,
    day_count: "30/360",
    rating: "BBB+",
    benchmark_tenor: 10,
    notes: "Placeholder terms; replace coupon, maturity and CUSIP with the real issue.",
  },
  {
    sector: "Financials",
    name: "JPMorgan Chase senior note (placeholder terms)",
    issuer: "JPMorgan Chase & Co",
    instrument_type: "corporate",
    pricing_method: "manual",
    weight: 5.0,
    cusip: cusip("ZJPMC0B2"),
    coupon_rate: 4.95,
    issue_date: "2025-01-15",
    maturity_date: "2035-01-15",
    payment_frequency: 2,
    day_count: "30/360",
    rating: "A-",
    benchmark_tenor: 10,
    notes: "Placeholder terms; replace coupon, maturity and CUSIP with the real issue.",
  },
  {
    sector: "Industrials",
    name: "Caterpillar Financial senior note (placeholder terms)",
    issuer: "Caterpillar Financial Services Corp",
    instrument_type: "corporate",
    pricing_method: "manual",
    weight: 4.4,
    cusip: cusip("ZCATF0C3"),
    coupon_rate: 4.55,
    issue_date: "2024-03-15",
    maturity_date: "2031-03-15",
    payment_frequency: 2,
    day_count: "30/360",
    rating: "A",
    benchmark_tenor: 5,
    notes: "Placeholder terms; replace coupon, maturity and CUSIP with the real issue.",
  },
  {
    sector: null,
    name: "Money market sweep",
    issuer: null,
    instrument_type: "money_market",
    pricing_method: "live",
    weight: 1.1,
    day_count: "ACT/360",
    notes: "Broker sweep, priced at par (1.00).",
  },
];

// ── People ──────────────────────────────────────────────────────────────────

interface UserSeed {
  email: string;
  full_name: string;
  is_app_admin?: boolean;
  is_faculty_advisor?: boolean;
}

interface MembershipSeed {
  email: string;
  fund: FundSlug;
  role: MembershipRole;
  sector?: string | null;
  is_sector_leader?: boolean;
  title_override?: string | null;
}

function sectorEmail(fund: FundSlug, sector: string, suffix: string): string {
  return `${fund}.${slugify(sector)}.${suffix}@${PLACEHOLDER_DOMAIN}`;
}

function buildPeople(): { users: UserSeed[]; memberships: MembershipSeed[] } {
  const users: UserSeed[] = [
    { email: ADMIN_EMAIL, full_name: "Ryan (App Admin)", is_app_admin: true },
    { email: ADVISOR_EMAIL, full_name: "SMIF Faculty Advisor", is_faculty_advisor: true },
  ];
  const memberships: MembershipSeed[] = [
    // The app admin sits in both funds as a read-only member; the admin flag,
    // not the membership, is what grants the admin tools.
    { email: ADMIN_EMAIL, fund: "athena", role: "viewer", title_override: "App Administrator" },
    { email: ADMIN_EMAIL, fund: "arch", role: "viewer", title_override: "App Administrator" },
    // The faculty advisor gets no membership on purpose: access comes from the
    // is_faculty_advisor flag, which is worth exercising.
  ];

  // Officers
  const officers: Array<UserSeed & { m: MembershipSeed }> = [
    {
      email: `athena.president@${PLACEHOLDER_DOMAIN}`,
      full_name: "Athena President",
      m: { email: "", fund: "athena", role: "president" },
    },
    {
      email: `athena.vp@${PLACEHOLDER_DOMAIN}`,
      full_name: "Athena Vice President",
      m: { email: "", fund: "athena", role: "vice_president" },
    },
    {
      email: `athena.pm@${PLACEHOLDER_DOMAIN}`,
      full_name: "Athena Portfolio Manager",
      m: { email: "", fund: "athena", role: "portfolio_manager" },
    },
    {
      email: `athena.alumni.relations@${PLACEHOLDER_DOMAIN}`,
      full_name: "Athena Alumni Relations",
      m: { email: "", fund: "athena", role: "alumni_relations" },
    },
    {
      email: `arch.copresident.one@${PLACEHOLDER_DOMAIN}`,
      full_name: "Arch Co-President One",
      m: { email: "", fund: "arch", role: "president", title_override: "Co-President" },
    },
    {
      email: `arch.copresident.two@${PLACEHOLDER_DOMAIN}`,
      full_name: "Arch Co-President Two",
      m: { email: "", fund: "arch", role: "president", title_override: "Co-President" },
    },
    {
      email: `arch.pm@${PLACEHOLDER_DOMAIN}`,
      full_name: "Arch Portfolio Manager",
      m: { email: "", fund: "arch", role: "portfolio_manager" },
    },
  ];
  for (const officer of officers) {
    users.push({ email: officer.email, full_name: officer.full_name });
    memberships.push({ ...officer.m, email: officer.email });
  }

  // One leader and two analysts per sector, in both funds.
  for (const fund of ["athena", "arch"] as FundSlug[]) {
    const label = fund === "athena" ? "Athena" : "Arch";
    for (const sector of SECTORS[fund]) {
      const leaderEmail = sectorEmail(fund, sector, "leader");
      users.push({ email: leaderEmail, full_name: `${label} ${sector} Leader` });
      memberships.push({
        email: leaderEmail,
        fund,
        role: "sector_leader",
        sector,
        is_sector_leader: true,
      });
      for (const [n, word] of [
        [1, "One"],
        [2, "Two"],
      ] as Array<[number, string]>) {
        const email = sectorEmail(fund, sector, `analyst${n}`);
        users.push({ email, full_name: `${label} ${sector} Analyst ${word}` });
        memberships.push({ email, fund, role: "analyst", sector });
      }
    }
  }

  // Two people who sit in both funds with different roles, so the fund
  // switcher and per-fund permission checks have something real to show.
  memberships.push({
    email: `athena.vp@${PLACEHOLDER_DOMAIN}`,
    fund: "arch",
    role: "analyst",
    sector: "Macro",
  });
  memberships.push({
    email: sectorEmail("athena", "Technology", "leader"),
    fund: "arch",
    role: "viewer",
  });

  return { users, memberships };
}

// ── Phase 1: funds, academic year, sectors ──────────────────────────────────

interface FundRow {
  id: string;
  slug: FundSlug;
}
interface SectorRow {
  id: string;
  fund_id: string;
  name: string;
}

interface Core {
  funds: Map<FundSlug, string>;
  yearId: string;
  /** `${fundSlug}:${sectorName}` → sector id */
  sectors: Map<string, string>;
}

async function seedCore(): Promise<Core> {
  check(
    await db.from("funds").upsert(
      FUNDS.map((f) => ({
        slug: f.slug,
        name: f.name,
        asset_class: f.asset_class,
        benchmark_symbol: f.benchmark_symbol,
        benchmark_name: f.benchmark_name,
        vote_pass_threshold_pct: 60,
        vote_quorum_pct: null,
        vote_default_window_hours: 48,
        inception_date: f.inception_date,
        meeting_day: f.meeting_day,
        allowed_email_domains: ALLOWED_DOMAINS,
        settings: f.settings,
      })),
      { onConflict: "slug" }
    ),
    "funds upsert"
  );
  const fundRows = must(
    await db.from("funds").select("id, slug"),
    "funds select"
  ) as FundRow[];
  const funds = new Map<FundSlug, string>(fundRows.map((f) => [f.slug, f.id]));
  console.log(`  funds: ${fundRows.length}`);

  // Only one row may have is_current, so stand the others down first.
  check(
    await db
      .from("academic_years")
      .update({ is_current: false })
      .neq("label", YEAR_LABEL),
    "academic_years stand down"
  );
  const yearRows = must(
    await db
      .from("academic_years")
      .upsert(
        {
          label: YEAR_LABEL,
          starts_on: YEAR_START,
          ends_on: YEAR_END,
          is_current: true,
        },
        { onConflict: "label" }
      )
      .select("id"),
    "academic_years upsert"
  ) as Array<{ id: string }>;
  const yearId = yearRows[0].id;
  console.log(`  academic year: ${YEAR_LABEL}`);

  const sectorPayload = (["athena", "arch"] as FundSlug[]).flatMap((slug) => {
    const fundId = funds.get(slug);
    if (!fundId) throw new Error(`fund ${slug} missing after upsert`);
    return SECTORS[slug].map((name, index) => ({
      fund_id: fundId,
      name,
      slug: slugify(name),
      sort_order: index,
      is_strategy_team: name === STRATEGY_TEAM[slug],
      is_active: true,
    }));
  });
  check(
    await db.from("sectors").upsert(sectorPayload, { onConflict: "fund_id,slug" }),
    "sectors upsert"
  );
  const sectorRows = must(
    await db.from("sectors").select("id, fund_id, name"),
    "sectors select"
  ) as SectorRow[];
  const slugByFundId = new Map([...funds].map(([slug, id]) => [id, slug]));
  const sectors = new Map<string, string>();
  for (const s of sectorRows) {
    const fundSlug = slugByFundId.get(s.fund_id);
    if (fundSlug) sectors.set(`${fundSlug}:${s.name}`, s.id);
  }
  console.log(`  sectors: ${sectorRows.length}`);

  return { funds, yearId, sectors };
}

// ── Phase 2: users and memberships ──────────────────────────────────────────

interface AuthUserRow {
  id: string;
  email?: string;
}

async function listAllUsers(): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>();
  const perPage = 1000;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const users: AuthUserRow[] = data.users;
    for (const u of users) {
      if (u.email) byEmail.set(u.email.toLowerCase(), u.id);
    }
    if (users.length < perPage) break;
  }
  return byEmail;
}

async function seedPeople(core: Core): Promise<{
  idByEmail: Map<string, string>;
  created: number;
  memberships: number;
}> {
  const { users, memberships } = buildPeople();
  const existing = await listAllUsers();
  const idByEmail = new Map<string, string>();
  let created = 0;

  for (const user of users) {
    const key = user.email.toLowerCase();
    let id = existing.get(key);
    if (!id) {
      const { data, error } = await db.auth.admin.createUser({
        email: user.email,
        email_confirm: true,
        password: DEMO_PASSWORD,
        user_metadata: { full_name: user.full_name },
      });
      if (error || !data.user) {
        console.warn(`  user ${user.email}: ${error?.message ?? "no user returned"}`);
        continue;
      }
      id = data.user.id;
      created += 1;
    }
    idByEmail.set(key, id);
    // The full_name is only written when the account is new, so rerunning the
    // seed never renames a real person who happens to share an address (the
    // app admin, usually).
    const profilePatch: Record<string, unknown> = {
      is_app_admin: user.is_app_admin ?? false,
      is_faculty_advisor: user.is_faculty_advisor ?? false,
    };
    if (!existing.has(key)) profilePatch.full_name = user.full_name;
    const { error: profileError } = await db
      .from("profiles")
      .update(profilePatch)
      .eq("id", id);
    if (profileError) {
      console.warn(`  profile ${user.email}: ${profileError.message}`);
    }
  }
  console.log(`  users: ${idByEmail.size} (${created} new, password "${DEMO_PASSWORD}")`);

  const payload = memberships.flatMap((m) => {
    const userId = idByEmail.get(m.email.toLowerCase());
    const fundId = core.funds.get(m.fund);
    if (!userId || !fundId) return [];
    const sectorId = m.sector ? core.sectors.get(`${m.fund}:${m.sector}`) ?? null : null;
    return [
      {
        user_id: userId,
        fund_id: fundId,
        academic_year_id: core.yearId,
        role: m.role,
        sector_id: sectorId,
        is_sector_leader: m.is_sector_leader ?? false,
        status: "active",
        title_override: m.title_override ?? null,
      },
    ];
  });
  for (const batch of chunk(payload, 200)) {
    check(
      await db
        .from("memberships")
        .upsert(batch, { onConflict: "user_id,fund_id,academic_year_id" }),
      "memberships upsert"
    );
  }
  console.log(`  memberships: ${payload.length}`);

  return { idByEmail, created, memberships: payload.length };
}

// ── Holdings ────────────────────────────────────────────────────────────────

interface HoldingRow {
  id: string;
  symbol: string | null;
  name: string;
}

type HoldingPayload = Record<string, unknown>;

/** Upserts holdings keyed by symbol (equities/ETFs) or name (bonds). */
async function upsertHoldings(
  fundId: string,
  rows: Array<HoldingPayload & { symbol?: string | null; name: string }>
): Promise<Map<string, string>> {
  const existing = (must(
    await db.from("holdings").select("id, symbol, name").eq("fund_id", fundId),
    "holdings select"
  ) as HoldingRow[]).reduce((map, h) => {
    map.set((h.symbol ?? h.name).toUpperCase(), h.id);
    return map;
  }, new Map<string, string>());

  const ids = new Map<string, string>();
  const inserts: HoldingPayload[] = [];
  for (const row of rows) {
    const key = (row.symbol ?? row.name).toUpperCase();
    const id = existing.get(key);
    if (id) {
      check(
        await db.from("holdings").update(row).eq("id", id),
        `holding update ${key}`
      );
      ids.set(key, id);
    } else {
      inserts.push({ ...row, fund_id: fundId });
    }
  }
  if (inserts.length > 0) {
    const inserted = must(
      await db.from("holdings").insert(inserts).select("id, symbol, name"),
      "holdings insert"
    ) as HoldingRow[];
    for (const h of inserted) ids.set((h.symbol ?? h.name).toUpperCase(), h.id);
  }
  return ids;
}

async function seedAthenaHoldings(core: Core): Promise<{
  ids: Map<string, string>;
  count: number;
  cash: number;
}> {
  const fundId = core.funds.get("athena");
  if (!fundId) throw new Error("athena fund missing");

  const symbols = [...ATHENA_HOLDINGS.map((h) => h.symbol), ATHENA_CLOSED_HOLDING.symbol];
  const prices = await getPrices(symbols);

  // Normalize to 100 including the cash weight.
  const totalWeight =
    ATHENA_HOLDINGS.reduce((sum, h) => sum + h.weight, 0) + ATHENA_CASH_WEIGHT;
  const scale = 100 / totalWeight;

  let invested = 0;
  const rows: Array<HoldingPayload & { symbol: string; name: string }> =
    ATHENA_HOLDINGS.map((h) => {
      const price = prices.get(h.symbol) ?? FALLBACK_PRICES[h.symbol];
      const weight = h.weight * scale;
      const quantity = Math.round(((weight / 100) * ATHENA_TOTAL) / price);
      const avgCost = round(price * randBetween(`${h.symbol}:cost`, 0.8, 0.98), 4);
      invested += quantity * price;
      return {
        sector_id: core.sectors.get(`athena:${h.sector}`) ?? null,
        instrument_type: h.instrument_type,
        symbol: h.symbol,
        name: h.name,
        quantity,
        avg_cost: avgCost,
        pricing_method: "live" as PricingMethod,
        is_active: true,
        opened_on: h.opened_on ?? DEFAULT_OPENED_ON,
        closed_on: null,
      };
    });

  const closed = ATHENA_CLOSED_HOLDING;
  const closedPrice = prices.get(closed.symbol) ?? FALLBACK_PRICES[closed.symbol];
  rows.push({
    sector_id: core.sectors.get(`athena:${closed.sector}`) ?? null,
    instrument_type: closed.instrument_type,
    symbol: closed.symbol,
    name: closed.name,
    quantity: 0,
    avg_cost: round(closedPrice * randBetween(`${closed.symbol}:cost`, 0.8, 0.98), 4),
    pricing_method: "live" as PricingMethod,
    is_active: false,
    opened_on: closed.opened_on ?? DEFAULT_OPENED_ON,
    closed_on: closed.closed_on,
  });

  const ids = await upsertHoldings(fundId, rows);
  const cash = round(Math.max(0, ATHENA_TOTAL - invested), 2);
  check(
    await db.from("funds").update({ cash_balance: cash }).eq("id", fundId),
    "athena cash_balance"
  );
  console.log(
    `  athena holdings: ${rows.length} (1 closed), cash $${cash.toLocaleString("en-US")}`
  );
  return { ids, count: rows.length, cash };
}

async function seedArchHoldings(core: Core): Promise<{
  ids: Map<string, string>;
  count: number;
  cash: number;
}> {
  const fundId = core.funds.get("arch");
  if (!fundId) throw new Error("arch fund missing");

  const prices = await getPrices(["AGG"]);
  const aggPrice = prices.get("AGG") ?? FALLBACK_PRICES.AGG;

  let invested = 0;
  const rows = ARCH_HOLDINGS.map((b) => {
    let quantity: number;
    let avgCost: number;
    if (b.instrument_type === "etf") {
      quantity = Math.round(((b.weight / 100) * ARCH_TOTAL) / aggPrice);
      avgCost = round(aggPrice * randBetween(`${b.name}:cost`, 0.94, 1.0), 4);
      invested += quantity * aggPrice;
    } else if (b.instrument_type === "money_market") {
      // Par value units at 1.00, rounded down to a round lot of 100.
      quantity = Math.floor(((b.weight / 100) * ARCH_TOTAL) / 100) * 100;
      avgCost = 1;
      invested += quantity;
    } else {
      // Face value, rounded down to the nearest $1,000.
      quantity = Math.floor(((b.weight / 100) * ARCH_TOTAL) / 1000) * 1000;
      avgCost = round(randBetween(`${b.name}:cost`, 96, 101), 4);
      invested += (quantity * avgCost) / 100;
    }
    return {
      sector_id: b.sector ? core.sectors.get(`arch:${b.sector}`) ?? null : null,
      instrument_type: b.instrument_type,
      symbol: b.symbol ?? null,
      cusip: b.cusip ?? null,
      name: b.name,
      issuer: b.issuer,
      quantity,
      avg_cost: avgCost,
      coupon_rate: b.coupon_rate ?? null,
      maturity_date: b.maturity_date ?? null,
      issue_date: b.issue_date ?? null,
      payment_frequency: b.payment_frequency ?? null,
      day_count: b.day_count ?? null,
      rating: b.rating ?? null,
      pricing_method: b.pricing_method,
      benchmark_tenor: b.benchmark_tenor ?? null,
      is_active: true,
      opened_on: b.issue_date ?? "2025-09-15",
      closed_on: null,
      notes: b.notes ?? null,
    };
  });

  const ids = await upsertHoldings(fundId, rows);
  const cash = round(Math.max(0, ARCH_TOTAL - invested), 2);
  check(
    await db.from("funds").update({ cash_balance: cash }).eq("id", fundId),
    "arch cash_balance"
  );
  console.log(`  arch holdings: ${rows.length}, cash $${cash.toLocaleString("en-US")}`);
  return { ids, count: rows.length, cash };
}

// ── Bond marks ──────────────────────────────────────────────────────────────

async function seedBondMarks(
  archIds: Map<string, string>,
  markedBy: string
): Promise<number> {
  const friday = lastFriday();
  const markedAt = friday.toISOString();
  const dayStart = `${isoDate(friday)}T00:00:00Z`;
  const dayEnd = `${isoDate(friday)}T23:59:59Z`;
  let written = 0;

  for (const bond of ARCH_HOLDINGS) {
    if (bond.pricing_method !== "manual") continue;
    const holdingId = archIds.get(bond.name.toUpperCase());
    if (!holdingId) continue;

    const already = must(
      await db
        .from("bond_marks")
        .select("id")
        .eq("holding_id", holdingId)
        .gte("marked_at", dayStart)
        .lte("marked_at", dayEnd),
      "bond_marks select"
    ) as Array<{ id: string }>;
    if (already.length > 0) continue;

    const cleanPrice = round(randBetween(`${bond.name}:mark`, 98, 102), 3);
    const tenor = bond.benchmark_tenor ?? 7;
    const duration = round(tenor * 0.78 + rand(`${bond.name}:dur`) * 0.4, 3);
    const coupon = bond.coupon_rate ?? 5;
    // Rough current yield plus pull-to-par over the remaining life.
    const ytm = round(coupon + (100 - cleanPrice) / Math.max(duration, 1), 3);

    check(
      await db
        .from("bond_marks")
        .insert({
          holding_id: holdingId,
          clean_price: cleanPrice,
          ytm,
          duration,
          source: "broker",
          marked_by: markedBy,
          marked_at: markedAt,
          notes: "Seed data — placeholder mark, replace with a real broker quote.",
        }),
      `bond_marks insert ${bond.name}`
    );
    // Keep the holding's headline duration/ytm in step with its latest mark.
    check(
      await db.from("holdings").update({ duration, ytm }).eq("id", holdingId),
      `holding duration ${bond.name}`
    );
    written += 1;
  }
  console.log(`  bond marks: ${written} new, dated ${isoDate(friday)}`);
  return written;
}

// ── Treasury curve ──────────────────────────────────────────────────────────

const SYNTHETIC_CURVE: Array<[number, number]> = [
  [1, 4.05], [2, 4.05], [3, 4.0], [4, 3.98], [6, 3.92], [12, 3.8],
  [24, 3.7], [36, 3.72], [60, 3.85], [84, 4.0], [120, 4.2], [240, 4.55], [360, 4.6],
];

/** A plausible, slightly drifting curve for the last 30 weekdays. */
function synthesizeCurve(days: number): TreasuryCurvePoint[] {
  const points: TreasuryCurvePoint[] = [];
  let offset = 0;
  while (points.length < days * SYNTHETIC_CURVE.length && offset < days * 3) {
    const date = daysAgo(offset);
    offset += 1;
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const curveDate = isoDate(date);
    for (const [tenor, base] of SYNTHETIC_CURVE) {
      const wiggle = (rand(`${curveDate}:${tenor}`) - 0.5) * 0.08;
      points.push({
        curve_date: curveDate,
        tenor_months: tenor,
        yield_pct: round(base + wiggle, 4),
      });
    }
  }
  return points;
}

/** Keeps the most recent `days` curve dates that are not in the future. */
function lastCurveDates(points: TreasuryCurvePoint[], days: number): TreasuryCurvePoint[] {
  const today = isoDate(new Date());
  const dates = [...new Set(points.map((p) => p.curve_date))]
    .filter((d) => d <= today)
    .sort()
    .slice(-days);
  const keep = new Set(dates);
  return points.filter((p) => keep.has(p.curve_date));
}

async function seedTreasuryCurve(): Promise<number> {
  const year = new Date().getUTCFullYear();
  let points: TreasuryCurvePoint[] = [];
  let source = "treasury.gov";
  try {
    points = await fetchTreasuryCurve(year);
    if (new Set(points.map((p) => p.curve_date)).size < 30) {
      points = [...(await fetchTreasuryCurve(year - 1)), ...points];
    }
  } catch (err) {
    console.warn(`  treasury feed unavailable (${describe(err)})`);
    points = [];
  }
  points = lastCurveDates(points, 30);
  if (points.length === 0) {
    points = synthesizeCurve(30);
    source = "synthetic";
  }

  for (const batch of chunk(points, 500)) {
    check(
      await db
        .from("treasury_curve")
        .upsert(batch, { onConflict: "curve_date,tenor_months" }),
      "treasury_curve upsert"
    );
  }
  const dates = new Set(points.map((p) => p.curve_date)).size;
  console.log(`  treasury curve: ${points.length} rows across ${dates} dates (${source})`);
  return points.length;
}

// ── Trades ──────────────────────────────────────────────────────────────────

interface TradeSeed {
  symbol: string;
  action: "buy" | "sell";
  quantity: number;
  price: number;
  trade_date: string;
  notes: string;
}

/** SPEC 18: the Q3 2024 newsletter trades, so the ledger is not empty. */
const ATHENA_TRADES: TradeSeed[] = [
  {
    symbol: "GD",
    action: "buy",
    quantity: 800,
    price: 290,
    trade_date: "2024-08-15",
    notes: "Seed: Q3 2024 newsletter — initiate General Dynamics",
  },
  {
    symbol: "XLI",
    action: "sell",
    quantity: 1_900,
    price: 128.5,
    trade_date: "2024-08-15",
    notes: "Seed: Q3 2024 newsletter — exit XLI to fund General Dynamics",
  },
  {
    symbol: "OHI",
    action: "buy",
    quantity: 2_500,
    price: 38.75,
    trade_date: "2024-09-12",
    notes: "Seed: Q3 2024 newsletter — initiate Omega Healthcare",
  },
  {
    symbol: "MLM",
    action: "sell",
    quantity: 200,
    price: 545,
    trade_date: "2024-09-12",
    notes: "Seed: Q3 2024 newsletter — trim Martin Marietta",
  },
];

async function seedTrades(
  fundId: string,
  holdingIds: Map<string, string>,
  executedBy: string
): Promise<number> {
  const existing = must(
    await db.from("trades").select("notes").eq("fund_id", fundId),
    "trades select"
  ) as Array<{ notes: string | null }>;
  const seen = new Set(existing.map((t) => t.notes ?? ""));

  const rows = ATHENA_TRADES.filter((t) => !seen.has(t.notes)).flatMap((t) => {
    const holdingId = holdingIds.get(t.symbol);
    if (!holdingId) return [];
    const principal = round(t.quantity * t.price, 2);
    return [
      {
        fund_id: fundId,
        holding_id: holdingId,
        action: t.action,
        quantity: t.quantity,
        price: t.price,
        // Signed principal: negative on a buy, positive on a sell.
        amount: t.action === "buy" ? -principal : principal,
        accrued_interest: 0,
        commission: 0,
        trade_date: t.trade_date,
        executed_by: executedBy,
        notes: t.notes,
      },
    ];
  });
  if (rows.length > 0) {
    check(await db.from("trades").insert(rows), "trades insert");
  }
  console.log(`  trades: ${rows.length} new (${ATHENA_TRADES.length} seeded in total)`);
  return rows.length;
}

// ── Pitches and votes ───────────────────────────────────────────────────────

interface PitchSeed {
  title: string;
  sector: string;
  pitch_type: "bull" | "bear" | "single" | "rebalance";
  action: "buy" | "add" | "trim" | "sell" | "rebalance";
  symbol: string | null;
  instrument_name: string | null;
  holdingSymbol?: string;
  thesis_md: string;
  target_price: number | null;
  proposed_amount: number | null;
  status: "passed" | "failed" | "voting";
  votes_yes: number;
  votes_no: number;
  closedDaysAgo?: number;
}

const ATHENA_PITCHES: PitchSeed[] = [
  {
    title: "General Dynamics (GD) — initiate position",
    sector: "Industrials",
    pitch_type: "bull",
    action: "buy",
    symbol: "GD",
    instrument_name: "General Dynamics",
    thesis_md:
      "Placeholder thesis. Record backlog in Marine Systems, Gulfstream G700 deliveries ramping, and a defence budget that is not going down. Funded by exiting the XLI placeholder position.",
    target_price: 340,
    proposed_amount: 232_000,
    status: "passed",
    votes_yes: 18,
    votes_no: 5,
    closedDaysAgo: 14,
  },
  {
    title: "Ares Capital (ARCC) — initiate position",
    sector: "Financial Institutions Group",
    pitch_type: "bull",
    action: "buy",
    symbol: "ARCC",
    instrument_name: "Ares Capital",
    thesis_md:
      "Placeholder thesis. BDC yield looked attractive, but the class was not comfortable with credit risk this late in the cycle or with the leverage profile.",
    target_price: 25,
    proposed_amount: 150_000,
    status: "failed",
    votes_yes: 6,
    votes_no: 20,
    closedDaysAgo: 7,
  },
  {
    title: "Arista Networks (ANET) — add to position",
    sector: "Technology",
    pitch_type: "bull",
    action: "add",
    symbol: "ANET",
    instrument_name: "Arista Networks",
    holdingSymbol: "ANET",
    thesis_md:
      "Placeholder thesis. Cloud titan capex guidance moved up again and the 800G cycle is still early. Proposal: take Technology to the top of its target band.",
    target_price: 165,
    proposed_amount: 120_000,
    status: "voting",
    votes_yes: 8,
    votes_no: 2,
  },
];

interface MembershipVoterRow {
  user_id: string;
  role: MembershipRole;
}

async function seedPitches(
  core: Core,
  holdingIds: Map<string, string>,
  idByEmail: Map<string, string>
): Promise<number> {
  const fundId = core.funds.get("athena");
  if (!fundId) throw new Error("athena fund missing");

  const voterRows = must(
    await db
      .from("memberships")
      .select("user_id, role")
      .eq("fund_id", fundId)
      .eq("academic_year_id", core.yearId)
      .eq("status", "active"),
    "voters select"
  ) as MembershipVoterRow[];
  const adminId = idByEmail.get(ADMIN_EMAIL.toLowerCase());
  const voters = voterRows
    .filter((m) => m.role !== "viewer" && m.user_id !== adminId)
    .map((m) => m.user_id)
    .sort();
  const eligible = voters.length;

  const existing = must(
    await db.from("pitches").select("id, title").eq("fund_id", fundId),
    "pitches select"
  ) as Array<{ id: string; title: string }>;
  const idByTitle = new Map(existing.map((p) => [p.title, p.id]));

  let written = 0;
  for (const pitch of ATHENA_PITCHES) {
    const sectorId = core.sectors.get(`athena:${pitch.sector}`);
    if (!sectorId) continue;
    const authorId =
      idByEmail.get(sectorEmail("athena", pitch.sector, "analyst1").toLowerCase()) ??
      voters[0];
    if (!authorId) continue;

    const cast = pitch.votes_yes + pitch.votes_no;
    const resultPct = cast === 0 ? 0 : round((pitch.votes_yes / cast) * 100, 2);
    const closedAt =
      pitch.status === "voting" ? null : daysAgo(pitch.closedDaysAgo ?? 7).toISOString();
    const opensAt =
      pitch.status === "voting"
        ? daysAgo(0).toISOString()
        : daysAgo((pitch.closedDaysAgo ?? 7) + 2).toISOString();
    const closesAt =
      pitch.status === "voting"
        ? new Date(Date.now() + 48 * 3_600_000).toISOString()
        : closedAt;

    const row = {
      fund_id: fundId,
      sector_id: sectorId,
      author_id: authorId,
      title: pitch.title,
      pitch_type: pitch.pitch_type,
      action: pitch.action,
      holding_id: pitch.holdingSymbol
        ? holdingIds.get(pitch.holdingSymbol) ?? null
        : null,
      symbol: pitch.symbol,
      instrument_name: pitch.instrument_name,
      instrument_type: "equity",
      thesis_md: pitch.thesis_md,
      target_price: pitch.target_price,
      proposed_amount: pitch.proposed_amount,
      funding_source: "cash",
      status: pitch.status,
      scheduled_for: isoDate(daysAgo((pitch.closedDaysAgo ?? 0) + 2)),
      vote_opens_at: opensAt,
      vote_closes_at: closesAt,
      votes_yes: pitch.votes_yes,
      votes_no: pitch.votes_no,
      eligible_voters: eligible,
      result_pct: pitch.status === "voting" ? null : resultPct,
      closed_by: pitch.status === "voting" ? null : adminId ?? null,
      closed_at: closedAt,
    };

    let pitchId = idByTitle.get(pitch.title);
    if (pitchId) {
      check(
        await db.from("pitches").update(row).eq("id", pitchId),
        `pitch update ${pitch.title}`
      );
    } else {
      const inserted = must(
        await db.from("pitches").insert(row).select("id"),
        `pitch insert ${pitch.title}`
      ) as Array<{ id: string }>;
      pitchId = inserted[0].id;
    }
    written += 1;

    // Spread the tally across real placeholder voters so the officer-only
    // "who voted what" view has something to show. The starting point rotates
    // per pitch (deterministically) so it is not the same faces every time.
    const offset = voters.length > 0 ? seedFrom(pitch.title) % voters.length : 0;
    const rotated = [...voters.slice(offset), ...voters.slice(0, offset)];
    const castAt = closedAt
      ? new Date(Date.parse(closedAt) - 3_600_000).toISOString()
      : new Date().toISOString();
    const ballots = rotated.slice(0, cast).map((voterId, index) => ({
      pitch_id: pitchId,
      voter_id: voterId,
      choice: index < pitch.votes_yes ? "yes" : "no",
      comment: null,
      cast_at: castAt,
    }));
    if (ballots.length > 0) {
      check(
        await db.from("votes").upsert(ballots, { onConflict: "pitch_id,voter_id" }),
        `votes upsert ${pitch.title}`
      );
    }
  }
  console.log(
    `  pitches: ${written} (2 closed, 1 open vote closing in 48h), eligible voters ${eligible}`
  );
  return written;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("SMIF Hub seed\n");
  const summary: string[] = [];

  console.log("1/7 funds, academic year, sectors");
  let core: Core;
  try {
    core = await seedCore();
  } catch (err) {
    console.error(`  failed: ${describe(err)}`);
    console.error(
      "\nThe funds/year/sectors phase is the foundation for everything else. " +
        "Check that the migrations in supabase/migrations are applied " +
        "(node scripts/apply-migrations.mjs) and rerun."
    );
    process.exit(1);
    return;
  }
  summary.push(`funds ${core.funds.size}, sectors ${core.sectors.size}, year ${YEAR_LABEL}`);

  console.log("2/7 placeholder users and memberships");
  let idByEmail = new Map<string, string>();
  try {
    const people = await seedPeople(core);
    idByEmail = people.idByEmail;
    summary.push(`${people.idByEmail.size} users, ${people.memberships} memberships`);
  } catch (err) {
    console.error(`  failed: ${describe(err)}`);
    summary.push("users/memberships FAILED");
  }

  const athenaPm = idByEmail.get(`athena.pm@${PLACEHOLDER_DOMAIN}`);
  const archPm = idByEmail.get(`arch.pm@${PLACEHOLDER_DOMAIN}`);
  const adminId = idByEmail.get(ADMIN_EMAIL.toLowerCase());

  console.log("3/7 Athena holdings");
  let athenaIds = new Map<string, string>();
  try {
    const athena = await seedAthenaHoldings(core);
    athenaIds = athena.ids;
    summary.push(`athena ${athena.count} holdings, cash $${athena.cash.toLocaleString("en-US")}`);
  } catch (err) {
    console.error(`  failed: ${describe(err)}`);
    summary.push("athena holdings FAILED");
  }

  console.log("4/7 Arch holdings and bond marks");
  try {
    const arch = await seedArchHoldings(core);
    summary.push(`arch ${arch.count} holdings, cash $${arch.cash.toLocaleString("en-US")}`);
    const markedBy = archPm ?? adminId;
    if (markedBy) {
      const marks = await seedBondMarks(arch.ids, markedBy);
      summary.push(`${marks} new bond marks`);
    } else {
      console.warn("  bond marks skipped: no Arch PM or admin profile to attribute them to");
    }
  } catch (err) {
    console.error(`  failed: ${describe(err)}`);
    summary.push("arch holdings FAILED");
  }

  console.log("5/7 treasury curve");
  try {
    const rows = await seedTreasuryCurve();
    summary.push(`${rows} treasury curve rows`);
  } catch (err) {
    console.error(`  failed: ${describe(err)}`);
    summary.push("treasury curve FAILED");
  }

  console.log("6/7 historical trades");
  try {
    const fundId = core.funds.get("athena");
    const executedBy = athenaPm ?? adminId;
    if (fundId && executedBy && athenaIds.size > 0) {
      const count = await seedTrades(fundId, athenaIds, executedBy);
      summary.push(`${count} new trades`);
    } else {
      console.warn("  skipped: needs the Athena fund, holdings and a PM profile");
    }
  } catch (err) {
    console.error(`  failed: ${describe(err)}`);
    summary.push("trades FAILED");
  }

  console.log("7/7 pitches and votes");
  try {
    if (athenaIds.size > 0 && idByEmail.size > 0) {
      const count = await seedPitches(core, athenaIds, idByEmail);
      summary.push(`${count} pitches`);
    } else {
      console.warn("  skipped: needs holdings and placeholder users");
    }
  } catch (err) {
    console.error(`  failed: ${describe(err)}`);
    summary.push("pitches FAILED");
  }

  console.log("\nSeed complete");
  for (const line of summary) console.log(`  - ${line}`);
  console.log(
    `\nSign in as ${ADMIN_EMAIL} (app admin) or ` +
      `athena.pm@${PLACEHOLDER_DOMAIN} (Athena PM) with password "${DEMO_PASSWORD}".`
  );
  console.log(
    "Two placeholder people sit in both funds with different roles: " +
      `athena.vp@${PLACEHOLDER_DOMAIN} (Athena VP, Arch analyst) and ` +
      `${sectorEmail("athena", "Technology", "leader")} (Athena Technology leader, Arch viewer).`
  );
}

main().catch((err: unknown) => {
  console.error(describe(err));
  process.exit(1);
});
