# SMIF Hub — module contracts

Interfaces every module MUST expose, so independently built slices compile together. Import
types from `@/types/domain`. If a signature here is wrong for your needs,
extend it compatibly (add optional params) — never rename or remove.

Shared foundations that already exist (import, do not recreate):

- `@/types/domain` — all row types and view models
- `@/lib/permissions` — `can()`, `isOfficer()`, `canExecute()`, `effectiveRole()`, `roleLabel()`, `isActiveVoter()`, `leadsSector()`, `inSector()`, `OFFICER_ROLES`
- `@/lib/fund` — `getFundContext(slug)`, `getAuthState()`, `getAccessibleFunds()`, `getCurrentYear(supabase)`, `isFundSlug()`
- `@/lib/supabase/server` — `createSupabaseServerClient()` (user-scoped, RLS applies)
- `@/lib/supabase/client` — `createClient()` (browser)
- `@/lib/supabase/service` — `createServiceClient()` (service role; ONLY in `src/app/api/cron/**`, `src/app/api/auth/**`, roster import route, backup route)
- `@/lib/format` — `formatCurrency`, `formatCurrencyWhole`, `formatPercent`, `formatSignedPercent`, `formatSignedCurrency`, `formatBondPrice`, `formatNumber`, `formatDate`, `formatDateTime`, `easternDateString`
- `@/lib/csv` — `toCsv(headers, rows)`, `parseCsv(text)`
- `@/lib/chartTheme` — `getChartTheme(resolvedTheme, fundSlug)`, `GAIN_COLOR`, `LOSS_COLOR`
- `@/components/providers/ThemeProvider` — `useTheme()`
- UI kit: `@/components/ui/Card` (`Card`, `CardHeader`, `StatCard`), `@/components/ui/Badge` (`Badge`, `PitchStatusBadge`), `@/components/ui/Skeleton` (`Skeleton`, `TableSkeleton`, `DashboardSkeleton`), `@/components/ui/EmptyState` (`EmptyState`), `@/components/ui/Button` (`Button`)
- Layout: fund pages render inside `src/app/[fund]/layout.tsx`; `params` is a `Promise<{ fund: string }>` (Next 16 — always `await params`).

## src/lib/yahoo.ts (server-only)

```ts
export interface HistoryPoint { time: string; close: number; adjClose: number | null }
export type HistoryPeriod = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "ytd" | "1y" | "5y" | "max";

export async function getQuotes(symbols: string[]): Promise<Map<string, Quote>>; // batch, cached, price_snapshots fallback, never throws
export async function getQuote(symbol: string): Promise<Quote | null>;
export async function getHistory(symbol: string, period: HistoryPeriod): Promise<HistoryPoint[]>;
export async function getDailyHistory(symbol: string, from: Date): Promise<HistoryPoint[]>; // 1d interval, adjclose included
export async function searchSymbols(q: string): Promise<{ symbol: string; name: string; exchange: string; type: string }[]>;
export async function getRatesStrip(): Promise<{ symbol: string; label: string; yieldPct: number | null; change: number | null }[]>; // ^IRX 13w, ^FVX 5y, ^TNX 10y, ^TYX 30y
export function isMarketOpen(now?: Date): boolean; // Mon–Fri 9:30–16:00 ET minus NYSE_HOLIDAYS
export async function getKeyStats(symbol: string): Promise<Record<string, number | string | null>>; // quoteSummary subset for the detail page
```

## src/lib/bonds/*

```ts
// accrued.ts
export function accruedInterest(h: Holding, asOf: Date): number; // dollars, day_count aware
export function nextCouponDates(h: Holding, asOf: Date): { prev: Date; next: Date; daysInPeriod: number };
export function couponSchedule(h: Holding, asOf: Date): { date: Date; amount: number }[]; // remaining cash flows incl. principal

// treasury.ts
export async function fetchTreasuryCurve(year: number): Promise<TreasuryCurvePoint[]>; // parses the Treasury XML feed
export function interpolateYield(curve: TreasuryCurvePoint[], tenorYears: number): number | null; // linear between tenors
export interface TreasuryPrice { cleanPrice: number; accrued: number; ytm: number; duration: number }
export function priceTreasury(h: Holding, curve: TreasuryCurvePoint[], asOf: Date): TreasuryPrice | null;

// estimate.ts
export interface BondEstimate { cleanPrice: number; source: "mark" | "estimate"; markedAt: string; ytm: number | null; duration: number | null }
export function estimateBondPrice(h: Holding, lastMark: BondMark, curveAtMark: TreasuryCurvePoint[] | null, curveNow: TreasuryCurvePoint[] | null): BondEstimate;

// providers.ts
export interface BondPriceProvider {
  name: string;
  getPrice(input: { cusip?: string; isin?: string; asOf?: Date }): Promise<{ cleanPrice: number; ytm?: number; asOf: Date; source: string } | null>;
}
export class ManualMarkProvider implements BondPriceProvider {}
export class TreasuryCurveProvider implements BondPriceProvider {}
export class FinnhubProvider implements BondPriceProvider {} // throws "not configured" without FINNHUB_API_KEY
```

## src/lib/valuation.ts (server-only)

```ts
export async function valueFund(supabase: SupabaseClient, fundId: string): Promise<FundValuation>;
// - loads active holdings + sectors + latest sector_targets + latest bond_marks
// - equities/ETFs/money_market-with-symbol: getQuotes()
// - money_market without symbol: price 1.00, source "par"
// - treasuries: priceTreasury off the latest treasury_curve rows, source "curve"
// - manual bonds: latest mark, estimateBondPrice when the mark is older than today, source "mark"/"estimate"
// - marketValue for bonds = (cleanPrice + accruedPer100) / 100 * quantity(face)
// - weights vs totalValue (securities + fund.cash_balance); day change per position
```

## src/lib/performance.ts

```ts
export interface PeriodReturn { label: string; fund: number | null; benchmark: number | null; diff: number | null }
export function timeWeightedReturns(snapshots: FundSnapshot[], flows: CashMovement[], periods?: string[]): PeriodReturn[]; // MTD QTD YTD LTM 3Y SI
export function dailyReturnSeries(snapshots: FundSnapshot[], flows: CashMovement[]): ChartPoint[]; // cumulative growth of $1, chain-linked
export function benchmarkReturnSeries(snapshots: FundSnapshot[]): ChartPoint[]; // from benchmark_adj_close
export function drawdownSeries(points: ChartPoint[]): ChartPoint[];
export function monthlyReturnTable(snapshots: FundSnapshot[], flows: CashMovement[]): { year: number; months: (number | null)[]; total: number | null }[];
export function riskMetrics(snapshots: FundSnapshot[]): { volatility: number; maxDrawdown: number; beta: number | null; top5Weight?: number } | null;
```

## src/lib/audit.ts

```ts
export async function logAudit(supabase: SupabaseClient, entry: { actorId: string | null; fundId: string | null; action: string; entity: string; entityId?: string | null; before?: unknown; after?: unknown; ip?: string | null }): Promise<void>; // insert via RPC log_audit(...) — security definer, defined in migration
```

## src/lib/emails/send.ts (server-only)

```ts
export async function sendEmail(opts: { to: string[]; subject: string; heading: string; bodyLines: string[]; ctaLabel?: string; ctaPath?: string; fundSlug?: FundSlug }): Promise<void>; // Resend, branded template, accent by fund, never throws (logs)
export async function sendToFund(supabase: SupabaseClient, fundId: string, opts: { subject: string; heading: string; bodyLines: string[]; ctaLabel?: string; ctaPath?: string; essential?: boolean; roles?: MembershipRole[] }): Promise<void>; // active members, respects profiles.email_prefs unless essential
```

## src/lib/sheets/backup.ts (server-only, service client allowed)

```ts
export async function runBackup(triggeredBy: string): Promise<BackupRun>; // full backup per spec Section 15 + JSON.gz to storage; writes backup_runs
export async function appendTradeRow(fundSlug: FundSlug, trade: Trade, holdingName: string): Promise<void>; // real-time append after execute; never throws
```

## Postgres RPCs (defined in the migration, called via supabase.rpc)

```ts
supabase.rpc("execute_ticket", { p_ticket_id, p_fill_quantity, p_fill_price, p_accrued_interest, p_commission, p_trade_date, p_settlement_date, p_broker_reference, p_notes }) // → trade id; atomic ticket+ledger+holding+cash+audit
supabase.rpc("close_pitch_vote", { p_pitch_id }) // → { status, result_pct, votes_yes, votes_no }
supabase.rpc("log_audit", { p_fund_id, p_action, p_entity, p_entity_id, p_before, p_after }) // security definer insert
```

## Chart components (owned by the dashboard slice; import from here)

```ts
// src/components/charts/ValueChart.tsx — lightweight-charts area chart
export function ValueChart(props: { data: ChartPoint[]; benchmark?: ChartPoint[]; isPositive: boolean; fund: FundSlug; onCrosshairMove?: (v: number | null, t: string | null) => void; height?: number }): JSX.Element;
// src/components/charts/AllocationDonut.tsx — Recharts pie
export function AllocationDonut(props: { data: { name: string; value: number }[]; fund: FundSlug }): JSX.Element;
// src/components/charts/SectorBarChart.tsx — weight vs target vs benchmark
export function SectorBarChart(props: { data: { name: string; weight: number; target: number | null; benchmark: number | null }[]; fund: FundSlug }): JSX.Element;
// src/components/charts/CurveChart.tsx — treasury curve, one line per date
export function CurveChart(props: { series: { label: string; points: { tenorYears: number; yieldPct: number }[] }[]; fund: FundSlug }): JSX.Element;
```

## API routes (each slice owns its own; all validate with zod, 403 early via getFundContext + can())

- `GET /api/market/quotes?symbols=A,B` → `{ quotes: Quote[] }`
- `GET /api/market/history/[symbol]?period=1y` → `{ points: HistoryPoint[] }`
- `GET /api/market/search?q=` → `{ results: [...] }` (pitch editor, add holding)
- `GET /api/market/rates` → `{ rates: [...] }`
- `GET /api/[fund]/portfolio/history?period=` → `{ points: ChartPoint[]; benchmark: ChartPoint[] }` (from fund_snapshots)
- Pitches: `POST /api/[fund]/pitches`, `PATCH/DELETE /api/[fund]/pitches/[id]`, `POST /api/[fund]/pitches/[id]/submit|schedule|open-vote|close-vote|withdraw`, `POST /api/[fund]/pitches/[id]/files` (FormData upload to bucket `pitch-files`), `GET /api/[fund]/pitches/[id]/files/[fileId]` (302 to a freshly signed storage URL; the inline PDF viewer's `src`)
- Votes: `POST /api/[fund]/pitches/[id]/vote` `{ choice, comment? }`
- Tickets: `POST /api/[fund]/tickets`, `POST /api/[fund]/tickets/[id]/execute`, `POST /api/[fund]/tickets/[id]/cancel`
- Holdings admin: `POST/PATCH /api/[fund]/holdings(/[id])`, `POST /api/[fund]/marks` (single), `POST /api/[fund]/marks/csv`, `POST /api/[fund]/cash-movements`
- Roster: `POST /api/[fund]/members` (add one), `PATCH /api/[fund]/members/[id]`, `POST /api/[fund]/roster/import` (preview+commit; service role), `GET /api/[fund]/roster/export`
- Auth admin: `POST /api/auth/admin-reset` `{ userId }`, `POST /api/auth/set-temp-password` `{ userId }` (service role, officer-gated, audit-logged)
- Cron: `GET /api/cron/treasury-curve|eod-snapshot|votes|stale-marks|backup` (Bearer CRON_SECRET)
- Admin: `POST /api/admin/backup` (officer), `GET /api/admin/health`

## Conventions

- Server components fetch data directly via `createSupabaseServerClient()`; client components only for charts, forms, vote panel.
- Route handlers: `const ctx = await getFundContext(slug); if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });` then `can()` checks → 403 with a clear message.
- Zod-parse every request body/query. TypeScript strict; no `any` outside `src/lib/yahoo.ts`.
- Cast supabase rows to domain types: `(data as Holding[]) ?? []`.
- Numbers: `numeric` columns arrive as strings from PostgREST when large — coerce with `Number()` in lib code where math happens.
