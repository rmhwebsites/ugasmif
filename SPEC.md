# SMIF Hub - Build Spec for Claude Code

Central web app for the University of Georgia Student Managed Investment Fund (SMIF): the Athena Stock Fund and the Arch Bond Fund. One app, one login, a fund switcher, per-fund roles, a pitch-to-vote-to-trade workflow, live market data, and a nightly Google Sheets backup.

Owner: Ryan (ryan@rmh.productions). Reference implementation: https://github.com/rmhwebsites/GBH (Ryan's GBH Investments dashboard). Reuse its patterns wherever this spec says so.

---

## 0. How to use this document

1. Read the whole file before writing code. Sections 5 through 9 (domain model, roles, auth, schema, RLS) are the contract; do not deviate from them without asking.
2. Clone the GBH repo into a sibling folder and read it before starting. Section 3 lists what to reuse, what to change, and what to delete.
3. Build in the phases in Section 19. Each phase has acceptance criteria. Stop at the end of each phase and report.
4. Decisions that were already made are in Section 21. Anything marked "open" there is yours to ask about, not to guess.
5. Use fake dollar amounts and real securities for seed data (Section 18). The real holdings get loaded by the students later through the import tools.

Stack: Next.js (App Router, TypeScript strict), Tailwind CSS v4, Supabase (Postgres, Auth, Storage, RLS), yahoo-finance2 v4, Lightweight Charts v5 + Recharts, Resend, googleapis (Sheets), Vercel, GitHub.

---

## 1. What we are building

SMIF is a class of roughly 80 finance students who manage two live portfolios owned by the UGA Foundation. Athena holds about $4.5M in 41 stocks across 10 sector teams and is benchmarked to the S&P 500. Arch started trading in Fall 2025, holds about $2M in fixed income across 6 sector teams, and is benchmarked to the Bloomberg US Aggregate.

Today the process lives in decks, Bloomberg terminals, and a class vote after each meeting. The app becomes the hub for:

- Seeing the portfolio live: holdings, weights, day change, performance vs benchmark, sector allocation vs benchmark.
- Running the pitch cycle: sector teams draft and submit pitches, the class votes in the app with the fund's conviction threshold, a passed vote becomes a trade ticket, and only the fund's Portfolio Manager (or the faculty advisor) can mark it executed and touch the ledger.
- Sector team workspaces: each sector leader sees their team, their holdings, their sector's weight vs target and benchmark, and their pitch history.
- Turnover: every spring an officer uploads the new roster, the old class becomes read-only alumni, and nothing about that requires code.
- Backup and audit: every table mirrored to Google Sheets nightly, a real-time trade log tab, and an audit log of every write that matters.

---

## 2. SMIF facts that shape the design

Sourced from the March 2026 SMIF info session deck, the SMIF members page, and the Q3 2024 and Q4 2023 SMIF newsletters (links in Section 23).

### Athena Stock Fund

- ~$4.5M, 41 holdings, S&P 500 benchmark, top-down approach: Equity Strategies sets sector allocation, sector teams pitch individual names.
- Class: 4 officers (President, Vice President, Portfolio Manager, Director of Alumni Relations), 10 sector leaders, ~45 analysts.
- Sectors (exact names, use these): Communication Services, Consumer Discretionary, Energy & Utilities, Equity Strategies, Financial Institutions Group, Healthcare, Industrials, REITs & Materials, Staples, Technology.
- Meets Wednesdays 4:35-5:55 pm ET. Each sector delivers a Bull pitch and a Bear pitch per semester. After discussion the class votes electronically after class.
- Vote rule: a pitch passes at 60% of votes cast. Published results: General Dynamics passed at 78%, Omega Healthcare at 61%, ONEOK failed at 59%, Ares Capital failed at 23%.
- Equity Strategies pitches sector weights in August; reweighting happens in January.
- Trades often exceed $25,000. The UGA Foundation is custodian; the PM places trades with the broker. The app records and controls that; it never places orders itself.

### Arch Bond Fund

- Started active trading Fall 2025, ~$2M (Ryan's number for seed data), Bloomberg US Aggregate benchmark.
- Class: 3 officers (two Co-Presidents, Portfolio Manager), 6 sector leaders, ~24 analysts.
- Sectors (exact names): Financials, Industrials, Macro, Tactical Opportunities, Treasuries, Utilities.
- Meets Mondays 2:55-4:15 pm ET. One long pitch per class, vote after class.
- Published allocation (early 2026): AGG ETF ~60%, agency MBS ~17%, corporates ~14% (utilities, financials, industrials), Treasuries ~8%, money market <1%.

### The fact that decides the data model

The same students hold different roles in each fund. From the members page: Leon Cohen leads Financial Institutions Group in Athena and is Portfolio Manager of Arch. Lucy Fuselier is Athena Vice President and leads Treasuries in Arch. Dylan Van Saun is Athena President and leads Utilities in Arch. Josh Stevens leads Communication Services in Athena and Industrials in Arch. Some officers also lead a sector in the same fund (Advait Naik is Athena PM and leads Equity Strategies; Ryan Smaldino is Alumni Relations and leads Consumer Discretionary).

So: a user does not have a role. A user has a membership in a fund for an academic year, and the membership has a role, a sector, and a sector-leader flag. Every permission check is scoped to a fund.

---

## 3. Reference implementation: GBH

GBH (Next.js 16, Tailwind v4, Supabase, yahoo-finance2, Lightweight Charts, Resend, googleapis, Vercel crons) is the closest thing to a template. Read `README.md`, `PROGRESS.md`, `SETUP.md`, `supabase/*.sql`, `src/lib/*.ts`, and `src/app/api/admin/backup/route.ts` before writing anything.

### Reuse as-is or with light edits

| GBH piece | Use in SMIF |
|---|---|
| `src/lib/yahoo.ts` quote cache with market-hours TTL (5 min open, 60 min closed), `chart()` for history | Same approach. Upgrade to yahoo-finance2 v4 (`new YahooFinance()` is already the v3+ pattern; keep it). Node 22+. Server-side only. |
| `src/app/api/admin/backup/route.ts` + `src/lib/sheets-format.ts` (googleapis service account, one spreadsheet, one tab per table, formatted headers) | Same mechanism. New tab layout in Section 15. |
| `vercel.json` crons (backup at 04:00 UTC weekdays, NAV snapshot at 21:00 UTC weekdays) | Same shape. Schedule in Section 13.6. All crons are once per day so this works on Vercel Hobby. |
| Lightweight Charts portfolio chart with hover value and period selector, `chartTheme.ts`, auto light/dark theme with `theme-init.js` | Same. Theme colors change (Section 11.4). |
| Holdings table (sticky first column, horizontal scroll on mobile), allocation donut, sector chart | Same components, new columns per fund. |
| Stock detail page `/stock/[ticker]` with TradingView chart and key stats | Same for equities and ETFs. |
| Voting: `voting_sessions`, `votes`, decision (confirm/reject) mode, live tally, voter audit visible to admins | Rebuild on top of pitches (Section 12). Keep the tally UI. Threshold becomes a per-fund setting, not simple majority. |
| Attendance: `meetings`, `meeting_attendance`, per-member attendance rates | Same, scoped by fund. |
| Fund updates (`fund_updates`, unread badge) | Same, scoped by fund. |
| Resend helpers `resend.ts`, `emails.ts` trade alert template | Same pattern, new templates (Section 16). |
| PWA manifest and service worker | Keep. |

### Change

| GBH | SMIF |
|---|---|
| Memberstack auth, admin = env var IDs + `admin_members` table, all DB access through service role in API routes, RLS enabled with no policies | Supabase Auth (email + password). Roles live in `memberships`. RLS policies enforce access at the database. Route handlers use a user-scoped Supabase client so RLS applies. Service role only for crons, roster import, backup, and admin password tools. |
| Single fund | Two funds, URL-scoped (`/athena/...`, `/arch/...`), fund switcher in the nav. |
| Simple-majority decision vote | Yes/No vote with a per-fund pass threshold (default 60% of votes cast), an open/close window, one vote per active member per pitch. |
| Holdings are equities only | Holdings have an `instrument_type`. Bonds carry coupon, maturity, face, rating, duration, and a pricing method. |
| Hard-coded ticker-to-GICS map in `sectors.ts` | Sectors are rows in the database per fund; a holding points at a sector. Keep a GICS lookup only as a suggestion when adding a holding. |

### Delete (not applicable, the money belongs to the Foundation)

NAV per unit, `member_investments`, `fund_metadata.total_units_outstanding`, Stripe investment windows and webhooks, member statements (`statement.ts`, jsPDF), `fees.ts`, `units.ts`, `investments.ts`, `/dashboard/my-investment`, `/dashboard/invest`, `/admin/funding`, `/admin/investments`, recalibrate-with-Fidelity.

---

## 4. Stack and infrastructure

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 16, App Router, TypeScript strict, React 19 | Same major as GBH. |
| Styling | Tailwind CSS v4 | |
| Database | Supabase Postgres | Migrations as numbered files in `supabase/migrations/`. Never edit a shipped migration; add a new one. |
| Auth | Supabase Auth, email + password | No public sign-up. Users are created by roster import. See Section 7. |
| Auth email delivery | Resend as Supabase custom SMTP (`smtp.resend.com`, port 465, user `resend`, password = Resend API key, verified sending domain) | Invite, password reset, and email-change emails come from Supabase templates through Resend. |
| App email | Resend SDK | Pitch, vote, trade, and alert emails. |
| Market data | yahoo-finance2 v4 (MIT, unofficial) | Server-side only. Wrap every call so a Yahoo outage degrades to the last cached price, never a crash. |
| Treasury curve | US Treasury daily par yield curve XML feed | `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=YYYY` |
| Charts | Lightweight Charts v5 (time series), Recharts (allocation, bars) | |
| Files | Supabase Storage bucket `pitch-files` (decks, models), private, signed URLs | |
| Backup | googleapis + service account, one Google Sheet | Section 15. |
| Hosting | Vercel | Hobby works because every cron is daily. If intraday crons are ever wanted, either Vercel Pro or Supabase `pg_cron` + `pg_net` calling the route with a secret header. |
| Repo | GitHub, `main` protected, Vercel preview deploys per PR | |

Node version: 22 (yahoo-finance2 v4 requires it). Pin in `package.json` engines and `.nvmrc`.

---

## 5. Domain model

| Concept | Meaning |
|---|---|
| Fund | Athena or Arch. Carries benchmark, vote threshold, cash balance, settings. |
| Academic year | `2026-27` etc. One is current. Memberships belong to a year. |
| Profile | One row per auth user: name, email, global flags (`is_app_admin`, `is_faculty_advisor`). |
| Membership | user x fund x academic year. Has `role`, `sector_id`, `is_sector_leader`, `status`. This is where permissions come from. |
| Sector | Per fund. Athena has 10, Arch has 6. Editable in-app. |
| Holding | A position in a fund: equity, ETF, Treasury, corporate, agency MBS, municipal, money market. Points at a sector. |
| Pitch | A proposal from a sector team: buy, add, trim, sell, or a rebalance. Has a lifecycle (Section 12). |
| Vote | One per member per pitch: yes or no, optional comment. |
| Trade ticket | What a passed pitch (or a PM-initiated action) becomes. Pending until the PM records the fill. |
| Trade | Immutable ledger row created when a ticket is executed. Corrections are reversal rows, never edits. |
| Price snapshot | Cached quote per symbol with timestamp and source. |
| Bond mark | A manually entered price/yield for a bond with who marked it and when. |
| Fund snapshot | End-of-day market value, cash, total, benchmark level. Drives performance charts. |
| Sector target | Target weight and benchmark weight per sector per fund, set by Equity Strategies / Macro. |
| Meeting, attendance | Class meetings and who showed up. |
| Update | Officer-posted announcements per fund. |
| Audit log | Who did what to which row, before and after. |

---

## 6. Roles and permissions

### Global flags (on `profiles`)

- `is_app_admin`: Ryan and anyone he designates. Full access to both funds and all admin tools, except casting votes (admins are not students). Every admin action is audit-logged. Cannot be granted through the UI by anyone other than an app admin.
- `is_faculty_advisor`: Johannes Kohler (and successors). Read everything in both funds, can execute trades, can post updates, cannot edit rosters.

### Per-fund membership roles

`president`, `vice_president`, `portfolio_manager`, `alumni_relations`, `sector_leader`, `analyst`, `viewer`.

The first four are "officers." `viewer` is for trustees, donors, or guests: read-only. A membership with `status = 'alumni'` behaves like `viewer` regardless of its role.

`is_sector_leader` is a separate boolean because officers can also lead a sector.

### Permission matrix

Rows are actions, scoped to one fund. "Officer" = president, vice_president, portfolio_manager, alumni_relations.

| Action | Analyst | Sector leader | Officer | PM | Faculty advisor | App admin |
|---|---|---|---|---|---|---|
| View dashboard, holdings, performance, pitches, vote results, updates | yes | yes | yes | yes | yes | yes |
| View individual votes (who voted what) | no | no | yes | yes | yes | yes |
| Draft a pitch for own sector | yes | yes | yes | yes | no | yes |
| Submit a pitch (draft to submitted) | no | own sector | yes | yes | no | yes |
| Schedule a pitch for a class date, open/close voting | no | no | yes | yes | no | yes |
| Cast a vote | yes (active) | yes | yes | yes | no | no |
| Withdraw a pitch | author (while draft) | own sector | yes | yes | no | yes |
| Create a trade ticket | no | no | no | yes | yes | yes |
| Mark ticket executed, record fill, edit ledger, adjust cash | no | no | no | yes | yes | yes |
| Add/edit holdings directly, enter bond marks, upload marks CSV | no | no | no | yes | yes | yes |
| Set sector targets and benchmark weights | no | Equity Strategies / Macro leader | yes | yes | no | yes |
| Manage sectors, vote threshold, fund settings | no | no | yes | yes | no | yes |
| Roster import, edit memberships, start new academic year | no | no | yes | no | no | yes |
| Send password reset / set temporary password for a member | no | no | yes | no | no | yes |
| Post updates, record attendance | no | no | yes | yes | yes | yes |
| Trigger backup, view backup status, view audit log | no | no | yes | yes | yes | yes |
| Grant app admin | no | no | no | no | no | yes |

Enforce this three times: in RLS policies (source of truth), in route handlers (return 403 early with a clear message), and in the UI (hide what the user cannot do). Write the permission logic once in `src/lib/permissions.ts` and generate the SQL helper functions from the same table so they cannot drift.

---

## 7. Auth

### Model

- Supabase Auth, email + password. No public sign-up page. The login page has "Sign in" and "Forgot password" only.
- Users are created by the roster import (Section 17.1) or by an officer adding one person. Creation uses the service role: `auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name } })`, then `auth.admin.generateLink({ type: 'invite', email })` and the link goes out through Resend in a branded invite email. The link lands on `/auth/set-password`.
- Allowed domains: `uga.edu` by default plus an allowlist in fund settings (for the advisor, Ryan, trustees). Import rejects anything else with a clear row-level error.
- Sessions via `@supabase/ssr` with cookie-based sessions, `middleware.ts` refreshes the session and redirects unauthenticated users to `/login`.

### Password reset, user level

"Forgot password" calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: '/auth/reset' })`. Supabase sends the recovery email through Resend SMTP. `/auth/reset` calls `updateUser({ password })`.

### Password reset, admin level

On `/[fund]/admin/members/[id]` an officer or app admin has two buttons:

1. "Send reset link": server route uses `auth.admin.generateLink({ type: 'recovery', email })` and emails it via Resend, so the officer never sees the link. Audit-logged.
2. "Set temporary password": server route generates a 12-character password, calls `auth.admin.updateUserById(id, { password })`, sets `profiles.must_change_password = true`, shows the password once to the officer, and emails the member that an officer reset their password. On next login the middleware forces `/auth/change-password` before anything else. Audit-logged.

### Signed in but no membership

If a user has no active membership in any fund for the current academic year and no global flag, show `/no-access` ("Ask a SMIF officer to add you to the roster") and nothing else.

### Fund resolution

`/[fund]/...` where `[fund]` is `athena` or `arch`. Middleware checks the user has access to that fund (active membership, alumni membership, `is_faculty_advisor`, or `is_app_admin`), else 404. `/` redirects to the user's first accessible fund, remembering the last one used in a cookie `smif_fund`.

---

## 8. Database schema

Write this as `supabase/migrations/0001_init.sql`. Use `gen_random_uuid()`, `timestamptz`, `numeric` for money. Every table gets `created_at`, mutable tables get `updated_at` with a trigger. Enable RLS on every table. Grant the API roles the privileges PostgREST needs (GBH's `migration_repair_all.sql` has the exact GRANT block; copy it).

```sql
-- Funds and years -----------------------------------------------------------

create table funds (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('athena','arch')),
  name text not null,                       -- 'Athena Stock Fund', 'Arch Bond Fund'
  asset_class text not null check (asset_class in ('equity','fixed_income')),
  benchmark_symbol text not null,           -- 'SPY', 'AGG' (Yahoo symbols)
  benchmark_name text not null,             -- 'S&P 500', 'Bloomberg US Aggregate'
  vote_pass_threshold_pct numeric(5,2) not null default 60.00,
  vote_quorum_pct numeric(5,2),             -- null = no quorum rule
  vote_default_window_hours int not null default 24,
  cash_balance numeric(15,2) not null default 0,
  inception_date date,
  meeting_day int,                          -- 0=Sun..6=Sat, Athena 3, Arch 1
  allowed_email_domains text[] not null default array['uga.edu'],
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table academic_years (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,               -- '2026-27'
  starts_on date not null,
  ends_on date not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index academic_years_one_current on academic_years (is_current) where is_current;

-- People --------------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  is_app_admin boolean not null default false,
  is_faculty_advisor boolean not null default false,
  must_change_password boolean not null default false,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sectors (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  name text not null,
  slug text not null,
  sort_order int not null default 0,
  is_strategy_team boolean not null default false,  -- Equity Strategies / Macro: sets targets, holds nothing by default
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (fund_id, slug)
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  fund_id uuid not null references funds(id) on delete cascade,
  academic_year_id uuid not null references academic_years(id),
  role text not null check (role in ('president','vice_president','portfolio_manager','alumni_relations','sector_leader','analyst','viewer')),
  sector_id uuid references sectors(id) on delete set null,
  is_sector_leader boolean not null default false,
  status text not null default 'active' check (status in ('active','alumni','inactive')),
  title_override text,                      -- e.g. 'Co-President'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, fund_id, academic_year_id)
);
create index memberships_fund_year on memberships (fund_id, academic_year_id, status);

-- Portfolio -----------------------------------------------------------------

create table holdings (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  sector_id uuid references sectors(id) on delete set null,
  instrument_type text not null check (instrument_type in
    ('equity','etf','treasury','corporate','agency_mbs','municipal','money_market')),
  symbol text,                              -- Yahoo symbol for equity/etf/money_market; null for individual bonds
  cusip text,
  isin text,
  name text not null,
  issuer text,
  quantity numeric(18,6) not null default 0,   -- shares for equity/etf; face value in dollars for bonds
  avg_cost numeric(18,6) not null default 0,   -- per share; per 100 face for bonds
  -- bond fields (null for equities)
  coupon_rate numeric(8,4),                 -- percent, e.g. 4.25
  maturity_date date,
  issue_date date,
  first_coupon_date date,
  payment_frequency int default 2,          -- coupons per year
  day_count text check (day_count in ('30/360','ACT/ACT','ACT/360')),
  rating text,                              -- 'AA+', 'BBB', etc.
  duration numeric(8,4),                    -- modified duration, entered or computed
  ytm numeric(8,4),                         -- last known yield to maturity, percent
  pricing_method text not null default 'live' check (pricing_method in ('live','treasury_curve','manual')),
  benchmark_tenor numeric(5,2),             -- years, used for estimated marks (e.g. 10 for a 10y corporate)
  is_active boolean not null default true,
  opened_on date,
  closed_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (instrument_type not in ('equity','etf') or symbol is not null)
);
-- money_market with a null symbol is priced at 1.00; with a symbol (e.g. a broker sweep fund) it prices live.
create index holdings_fund_active on holdings (fund_id, is_active);

create table price_snapshots (
  id bigint generated always as identity primary key,
  symbol text not null,
  price numeric(18,6) not null,
  previous_close numeric(18,6),
  change_pct numeric(10,6),
  source text not null default 'yahoo',
  as_of timestamptz not null default now()
);
create index price_snapshots_symbol_asof on price_snapshots (symbol, as_of desc);

create table bond_marks (
  id uuid primary key default gen_random_uuid(),
  holding_id uuid not null references holdings(id) on delete cascade,
  clean_price numeric(12,6) not null,       -- per 100 face
  ytm numeric(8,4),
  duration numeric(8,4),
  source text not null default 'bloomberg' check (source in ('bloomberg','broker','finra_trace','other')),
  marked_by uuid not null references profiles(id),
  marked_at timestamptz not null default now(),
  notes text
);
create index bond_marks_holding on bond_marks (holding_id, marked_at desc);

create table treasury_curve (
  curve_date date not null,
  tenor_months int not null,                -- 1,2,3,4,6,12,24,36,60,84,120,240,360
  yield_pct numeric(8,4) not null,
  primary key (curve_date, tenor_months)
);

create table fund_snapshots (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  snapshot_date date not null,
  market_value numeric(15,2) not null,      -- securities only
  cash numeric(15,2) not null,
  total_value numeric(15,2) not null,
  benchmark_symbol text not null,
  benchmark_close numeric(18,6),
  benchmark_adj_close numeric(18,6),
  detail jsonb not null default '{}'::jsonb, -- per-holding values, sector weights, duration/ytm for Arch
  created_at timestamptz not null default now(),
  unique (fund_id, snapshot_date)
);

create table sector_targets (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  sector_id uuid not null references sectors(id) on delete cascade,
  target_weight_pct numeric(6,3) not null,
  benchmark_weight_pct numeric(6,3),
  effective_on date not null,
  set_by uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now(),
  unique (sector_id, effective_on)
);

-- Pitch cycle ---------------------------------------------------------------

create table pitches (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  sector_id uuid not null references sectors(id),
  author_id uuid not null references profiles(id),
  title text not null,
  pitch_type text not null check (pitch_type in ('bull','bear','single','rebalance')),
  action text not null check (action in ('buy','add','trim','sell','rebalance')),
  holding_id uuid references holdings(id),  -- required for add/trim/sell
  symbol text,                              -- for buy of a listed security
  instrument_name text,                     -- for bonds or anything without a symbol
  instrument_type text,
  thesis_md text,                           -- markdown
  target_price numeric(18,6),
  proposed_amount numeric(15,2),
  proposed_weight_pct numeric(6,3),
  funding_source text,                      -- 'cash' or 'sell XLI' etc.
  status text not null default 'draft' check (status in
    ('draft','submitted','scheduled','voting','passed','failed','withdrawn','executed')),
  scheduled_for date,
  vote_opens_at timestamptz,
  vote_closes_at timestamptz,
  votes_yes int not null default 0,
  votes_no int not null default 0,
  eligible_voters int,
  result_pct numeric(6,2),                  -- yes / (yes+no) * 100 at close
  closed_by uuid references profiles(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pitches_fund_status on pitches (fund_id, status);

create table pitch_files (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references pitches(id) on delete cascade,
  kind text not null check (kind in ('deck','model','other')),
  storage_path text not null,
  file_name text not null,
  uploaded_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table votes (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references pitches(id) on delete cascade,
  voter_id uuid not null references profiles(id),
  choice text not null check (choice in ('yes','no')),
  comment text,
  cast_at timestamptz not null default now(),
  unique (pitch_id, voter_id)
);

-- Trading -------------------------------------------------------------------

create table trade_tickets (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  pitch_id uuid references pitches(id),
  holding_id uuid references holdings(id),  -- null for a brand-new position until executed
  created_by uuid not null references profiles(id),
  action text not null check (action in ('buy','sell')),
  instrument_type text not null,
  symbol text,
  cusip text,
  name text not null,
  sector_id uuid references sectors(id),
  est_quantity numeric(18,6),
  est_price numeric(18,6),
  est_amount numeric(15,2),
  status text not null default 'pending' check (status in ('pending','executed','cancelled')),
  executed_by uuid references profiles(id),
  executed_at timestamptz,
  fill_quantity numeric(18,6),
  fill_price numeric(18,6),
  fill_amount numeric(15,2),
  accrued_interest numeric(15,2) default 0, -- bonds
  commission numeric(12,2) default 0,
  trade_date date,
  settlement_date date,
  broker_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table trades (                       -- immutable ledger
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id),
  ticket_id uuid references trade_tickets(id),
  holding_id uuid not null references holdings(id),
  action text not null check (action in ('buy','sell')),
  quantity numeric(18,6) not null,
  price numeric(18,6) not null,
  amount numeric(15,2) not null,            -- signed principal: negative for buy, positive for sell
  accrued_interest numeric(15,2) not null default 0,  -- signed the same way (buyer pays, seller receives)
  commission numeric(12,2) not null default 0,        -- always positive
  trade_date date not null,
  executed_by uuid not null references profiles(id),
  reverses_trade_id uuid references trades(id),  -- set on a correction row
  notes text,
  created_at timestamptz not null default now()
);
create index trades_fund_date on trades (fund_id, trade_date desc);

create table cash_movements (               -- contributions, dividends, coupons, fees
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id),
  kind text not null check (kind in ('contribution','withdrawal','dividend','coupon','interest','fee','adjustment')),
  amount numeric(15,2) not null,            -- signed
  holding_id uuid references holdings(id),
  occurred_on date not null,
  recorded_by uuid not null references profiles(id),
  notes text,
  created_at timestamptz not null default now()
);

-- Class operations ----------------------------------------------------------

create table meetings (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  meeting_date date not null,
  title text,
  notes text,
  created_at timestamptz not null default now()
);

create table meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  user_id uuid not null references profiles(id),
  present boolean not null default true,
  unique (meeting_id, user_id)
);

create table fund_updates (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid not null references funds(id) on delete cascade,
  author_id uuid not null references profiles(id),
  title text not null,
  body_md text not null,
  pinned boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table update_reads (
  update_id uuid not null references fund_updates(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (update_id, user_id)
);

-- System --------------------------------------------------------------------

create table audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  fund_id uuid references funds(id),
  action text not null,                     -- 'trade.execute', 'membership.update', 'auth.admin_reset', ...
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index audit_log_fund_time on audit_log (fund_id, created_at desc);

create table roster_imports (
  id uuid primary key default gen_random_uuid(),
  fund_id uuid references funds(id),
  academic_year_id uuid not null references academic_years(id),
  imported_by uuid not null references profiles(id),
  file_name text,
  rows_total int not null,
  rows_created int not null default 0,
  rows_updated int not null default 0,
  rows_failed int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table backup_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','ok','failed')),
  tabs_written int,
  rows_written int,
  error text,
  triggered_by text not null default 'cron' -- 'cron' | user id
);
```

Triggers and functions to add in the same migration:

- `set_updated_at()` on every table with `updated_at`.
- `handle_new_user()` on `auth.users` insert: creates the `profiles` row from `email` and `raw_user_meta_data.full_name`.
- `apply_trade()`: given a `trades` row, upserts the holding (new position, quantity and weighted average cost on buy, quantity down on sell, `is_active = false` and `closed_on` when quantity hits zero) and adjusts `funds.cash_balance` by `amount + accrued_interest - commission` (amount and accrued are signed, commission is positive, so a buy lowers cash by principal plus accrued plus commission and a sell raises it by principal plus accrued minus commission). Call it from the execute route inside a transaction (use a Postgres function `execute_ticket(ticket_id, fill...)` so the ticket update, the ledger insert, the holding upsert, the cash change, and the audit row are atomic).
- `close_pitch_vote(pitch_id)`: tallies `votes`, sets `votes_yes`, `votes_no`, `eligible_voters`, `result_pct`, `status` (`passed` if `result_pct >= funds.vote_pass_threshold_pct` and quorum met if set, else `failed`), and if passed (and `action != 'rebalance'`) inserts a pending `trade_tickets` row from the pitch. Callable by officers/PM or by the daily cron when `vote_closes_at` has passed.

---

## 9. Row Level Security

Helper functions (all `security definer`, `stable`, `set search_path = public`):

```sql
create function is_app_admin() returns boolean ...
  -- profiles.is_app_admin for auth.uid()
create function is_faculty_advisor() returns boolean ...
create function current_year_id() returns uuid ...
  -- academic_years where is_current
create function fund_membership(p_fund uuid) returns memberships ...
  -- the caller's membership row in p_fund for the current year, or the most recent alumni row
create function has_fund_access(p_fund uuid) returns boolean ...
  -- is_app_admin() or is_faculty_advisor() or an active/alumni membership exists
create function fund_role(p_fund uuid) returns text ...
  -- membership.role for active membership; 'viewer' for alumni; null if none
create function is_fund_officer(p_fund uuid) returns boolean ...
  -- role in (president, vice_president, portfolio_manager, alumni_relations) and status active, or is_app_admin()
create function can_execute(p_fund uuid) returns boolean ...
  -- fund_role = portfolio_manager and active, or is_faculty_advisor(), or is_app_admin()
create function leads_sector(p_sector uuid) returns boolean ...
  -- active membership in that sector's fund with sector_id = p_sector and is_sector_leader
create function in_sector(p_sector uuid) returns boolean ...
```

Policy rules by table (write them all out; this is the summary):

| Table | select | insert | update | delete |
|---|---|---|---|---|
| funds | has_fund_access(id) | admin | is_fund_officer(id) | never |
| academic_years | authenticated | admin or officer of any fund | same | never |
| profiles | own row, or has a fund in common with the caller, or admin/advisor | trigger only | own row (name, avatar) or admin; `is_app_admin`, `is_faculty_advisor`, `must_change_password` only via service role | never |
| sectors | has_fund_access(fund_id) | is_fund_officer(fund_id) | same | same (only if no holdings/pitches reference it) |
| memberships | has_fund_access(fund_id) | is_fund_officer(fund_id) or admin | same | same |
| holdings | has_fund_access(fund_id) | can_execute(fund_id) | same | never (deactivate instead) |
| price_snapshots | authenticated | service role | never | never |
| bond_marks | has_fund_access via holding | can_execute via holding | never | never |
| treasury_curve | authenticated | service role | service role | never |
| fund_snapshots | has_fund_access(fund_id) | service role or can_execute | never | never |
| sector_targets | has_fund_access(fund_id) | is_fund_officer(fund_id) or leads_sector where sectors.is_strategy_team | same | same |
| pitches | has_fund_access(fund_id) | in_sector(sector_id) and status = 'draft' | author while draft; leads_sector(sector_id) through submitted; is_fund_officer for scheduling and closing | author while draft; officer |
| pitch_files | via pitch | author or leads_sector while pitch not closed | never | same as insert |
| votes | own row; all rows if is_fund_officer or advisor | active member of fund, pitch.status = 'voting', now() between opens/closes | own row while voting open | never |
| trade_tickets | has_fund_access(fund_id) | can_execute(fund_id) or via close_pitch_vote | can_execute(fund_id) | never (cancel instead) |
| trades | has_fund_access(fund_id) | can_execute(fund_id) via execute_ticket only | never | never |
| cash_movements | has_fund_access(fund_id) | can_execute(fund_id) | never | never |
| meetings, meeting_attendance | has_fund_access | is_fund_officer or advisor | same | same |
| fund_updates | has_fund_access | is_fund_officer or advisor | author or officer | same |
| update_reads | own | own | own | own |
| audit_log | is_fund_officer(fund_id) or advisor or admin | service role and security-definer functions only | never | never |
| roster_imports, backup_runs | officers of any fund, advisor, admin | service role | service role | never |

Rule for route handlers: create the Supabase client from the request cookies (`createServerClient` from `@supabase/ssr`) so every query runs as the user. Use the service-role client only in: cron routes (protected by `CRON_SECRET` header), roster import, admin password tools, backup, and the trigger-driven functions. Write a unit test that greps `src/app/api` for `SUPABASE_SERVICE_ROLE_KEY` usage outside the allowed folders and fails if found.

---

## 10. Fund switcher

- Every app route lives under `/[fund]/` where `[fund]` is `athena` or `arch`. Deep links always say which fund they are about.
- The top bar shows a two-segment control "Athena | Arch". Only segments the user can access are enabled. A user with access to one fund sees the control disabled with the other segment greyed and a tooltip "You are not on the Arch roster."
- Switching preserves the sub-route when it exists in both funds (`/athena/pitches` to `/arch/pitches`), otherwise lands on the fund dashboard.
- The current fund's name, the user's role in that fund, and their sector show in the sidebar header, e.g. "Arch Bond Fund - Portfolio Manager" or "Athena - Analyst, Healthcare". This is how a student in both funds always knows which hat they are wearing.
- Cookie `smif_fund` remembers the last fund for the `/` redirect.
- Theme: one app theme, but each fund has an accent (Athena red `#BA0C2F` UGA red, Arch black/graphite with a gold `#CE9C5C` accent borrowed from GBH). Use the accent on the segment control, the sidebar header, and chart series so screenshots are unambiguous.

---

## 11. Pages and routes

### 11.1 Public

| Route | Purpose |
|---|---|
| `/login` | Email + password, "Forgot password" link. |
| `/auth/set-password` | Landing for invite links. |
| `/auth/reset` | Landing for recovery links. |
| `/auth/change-password` | Forced when `must_change_password`. |
| `/no-access` | Signed in, no roster entry. |

### 11.2 Member pages (`/[fund]/...`), visible to every member of the fund

| Route | What it shows |
|---|---|
| `/[fund]` (dashboard) | Total value, day change ($, %), cash, performance chart vs benchmark (1M/3M/YTD/1Y/All) with hover value, holdings table, sector allocation vs benchmark weight vs target, top/bottom movers today, next meeting, open votes banner, latest update. Arch adds: weighted duration, weighted YTM, allocation by instrument type, 2y/5y/10y/30y yields with day change. |
| `/[fund]/holdings` | Full holdings table. Equity columns: symbol, name, sector, shares, price, day change, market value, weight, cost basis, unrealized gain, since-added return. Bond columns: name, type, sector, face, coupon, maturity, price (with source badge: live / curve / marked 09/12 / est.), accrued, market value, weight, YTM, duration, rating. Filter by sector and type. Export CSV. |
| `/[fund]/holdings/[id]` | Position detail. Equities: Lightweight Charts price chart (1D to ALL), key stats from `quoteSummary`, position history (every trade in this name), pitches about this name. Bonds: mark history chart, cash flow schedule, Treasury spread at each mark, pitches. |
| `/[fund]/sectors` | Card per sector: leader, analysts, current weight, target, benchmark weight, over/underweight, holdings count, last pitch. |
| `/[fund]/sectors/[slug]` | Sector workspace: team list, holdings in the sector with the same table as above, weight vs target/benchmark chart over time, pitch list for the sector (draft/submitted/voting/passed/failed), "New pitch" button for members of the sector. |
| `/[fund]/pitches` | All pitches with status filter. Officers see a "Schedule" action on submitted pitches. |
| `/[fund]/pitches/new` and `/[fund]/pitches/[id]/edit` | Pitch editor (Section 12). |
| `/[fund]/pitches/[id]` | Pitch page: thesis, files, proposed trade, discussion notes, vote panel (cast vote while open; live tally of count only until close for members; full results after close), outcome badge, linked ticket and trade once executed. |
| `/[fund]/votes` | Open votes for the member, past votes with results. |
| `/[fund]/trades` | Ledger: filterable by symbol, action, sector, date. Shows pending tickets at top (read-only for non-PM). |
| `/[fund]/performance` | Performance vs benchmark table (MTD, QTD, YTD, LTM, 3Y, since inception), cumulative chart, drawdown, monthly returns table, sector attribution (contribution to return by sector since start of period). Arch adds curve chart over time and duration history. |
| `/[fund]/updates` | Officer posts, unread badge. |
| `/[fund]/team` | Roster for the current year grouped by sector with roles. Past years selectable. |
| `/[fund]/attendance` | Own attendance record; officers see everyone. |
| `/[fund]/profile` | Name, avatar, change password. |

### 11.3 Officer / PM pages (`/[fund]/admin/...`)

Guarded by `is_fund_officer` unless noted.

| Route | What it does |
|---|---|
| `/[fund]/admin` | Checklist: pending tickets, stale bond marks, pitches awaiting scheduling, votes closing today, last backup status, members who never set a password. |
| `/[fund]/admin/tickets` (PM, advisor, admin) | Pending tickets. "Record execution" form: fill quantity, fill price, accrued interest (bonds), commission, trade date, settlement date, broker reference, notes. Preview of holding and cash after. Submit calls `execute_ticket`. Cancel with reason. Create a ticket directly (no pitch) for rebalances, corporate actions, or advisor-directed trades; requires a reason. |
| `/[fund]/admin/holdings` (PM, advisor, admin) | Add/edit holdings, set sector, set pricing method, deactivate. Bond fields. "Enter mark" per bond and "Upload marks CSV" (columns: `cusip,clean_price,ytm,duration,source,marked_at`). Cash adjustments and cash movements (dividends, coupons, contributions). |
| `/[fund]/admin/pitches` | Schedule submitted pitches to a class date, open voting (sets `vote_opens_at`, `vote_closes_at`), close early, view who has not voted, send reminder. |
| `/[fund]/admin/sectors` | Add/rename/reorder sectors, mark strategy team, set targets and benchmark weights with an effective date. |
| `/[fund]/admin/members` | Roster table for the current year: role, sector, leader flag, status, last login, password set? Edit inline. Add one member. "Send reset link" and "Set temporary password" (Section 7). Roster CSV import. |
| `/[fund]/admin/year` | Start a new academic year: confirm, flips all current memberships to `alumni`, creates the year, prompts for roster import. |
| `/[fund]/admin/settings` | Vote threshold, quorum, default vote window, benchmark symbol, allowed email domains, meeting day, fund accent. |
| `/[fund]/admin/updates`, `/[fund]/admin/attendance` | As in GBH. |
| `/[fund]/admin/audit` | Audit log with filters. |
| `/admin` (app admin only) | Cross-fund: users, app admins, advisors, backup runs with "Run backup now", environment health (Yahoo reachable, Treasury feed fresh, Sheets reachable, Resend domain verified). |

### 11.4 Layout and design

- Sidebar navigation like GBH (collapsible on mobile), fund switcher and theme toggle in the top bar.
- Dark theme by default with auto light/dark from GBH. Palette: near-black background, warm off-white text, fund accent, green/red only for gains/losses.
- Numbers: tabular figures, two decimals for dollars, one decimal for percents, bond prices to three decimals per 100 face.
- Every table sortable, sticky header, sticky first column on mobile.
- Empty states tell the user what to do next ("No pitches yet. Sector leaders can start one from the sector page.").
- Loading: skeletons, never spinners on full pages.

---

## 12. Pitch, vote, ticket, execute

### States

```
draft -> submitted -> scheduled -> voting -> passed -> executed
                                         -> failed
any pre-voting state -> withdrawn
```

| Transition | Who | Side effects |
|---|---|---|
| create draft | any active member of the sector (officers: any sector) | none |
| submit | sector leader of that sector, or officer | email officers "Pitch submitted: {title}" |
| schedule | officer/PM | sets `scheduled_for`; shows on dashboard "Upcoming pitches" |
| open voting | officer/PM (button, or automatic at class end time if `settings.auto_open_votes`) | sets `vote_opens_at = now()`, `vote_closes_at = now() + fund.vote_default_window_hours` (editable), `eligible_voters` = count of active members with role != viewer; email all eligible "Vote open: {title}, closes {time}" |
| cast/change vote | eligible member while open | one row per voter; comment optional |
| reminder | daily cron 24h and 3h before close, or officer button | email non-voters only |
| close | officer/PM, or daily cron once `vote_closes_at` passed | `close_pitch_vote()`; email fund "Result: {title} passed at 74%" (or failed); if passed, create `trade_tickets` row and email PM + advisor "Ticket ready" |
| execute | PM, advisor, admin | `execute_ticket()`; pitch to `executed`; email fund "Trade executed: Bought 120 GD at $312.40"; append row to the Sheets Trades tab immediately |
| cancel ticket | PM, advisor, admin | reason required; pitch stays `passed` with a "not executed" note |

### Rules

- Threshold: `result_pct = yes / (yes + no) * 100`, passes when `>= funds.vote_pass_threshold_pct` (default 60). If `vote_quorum_pct` is set, also require `(yes + no) / eligible_voters * 100 >= vote_quorum_pct`. Store both numbers on the pitch so history never depends on current settings.
- Members see the count of votes cast while open, not the split. Officers, PM, and the advisor see the live split and the voter list. After close, members see yes/no counts and the percentage, never names.
- The pitch author and members of the pitching sector can vote (that is how the class does it today). Make this a fund setting `settings.sector_can_vote_on_own_pitch`, default true.
- Bull and bear pitches for the same name are separate pitch rows linked by `settings.paired_pitch_id`; the vote is on the bull (buy) proposal. Keep it simple: the bear pitch is recorded for the archive and shown on the same page.
- A pitch with `action = rebalance` (Equity Strategies in August, Macro for Arch) carries a JSON of proposed sector targets in `thesis_md` front matter; on pass, the officer applies them on `/admin/sectors` with the effective date. Do not auto-apply.
- Executing a buy for a symbol with no holding creates the holding in the ticket's sector with `pricing_method` inferred: `live` for equity/etf/money_market, `treasury_curve` for treasury, `manual` for everything else.

### Pitch editor fields

Title, pitch type, action, security (search via yahoo-finance2 `search()` for listed names; free text + CUSIP for bonds), sector (defaulted from the author's membership), thesis (markdown editor with headings for Business, Thesis, Valuation, Risks, Catalysts), target price, proposed amount or weight, funding source, deck upload (PDF/PPTX, 25MB), model upload (XLSX), bear pitch link. Autosave drafts.

---

## 13. Market data

### 13.1 Equities and ETFs

Port `src/lib/yahoo.ts` from GBH. Changes:

- `getQuotes(symbols[])` uses one `quote(symbols)` batch call instead of N calls.
- Persist every fetched quote to `price_snapshots` (fire-and-forget). If Yahoo throws, return the latest `price_snapshots` row for the symbol with `stale: true` and the age; the UI shows a small "delayed" badge. Never let a Yahoo failure 500 a page.
- Cache TTL: 5 minutes while the market is open (Mon-Fri 9:30-16:00 ET, skip NYSE holidays from a small static list), 60 minutes otherwise. Cache lives in module memory per serverless instance plus `price_snapshots` as the shared layer.
- History via `chart()` with the same period-to-interval map as GBH. Use the `adjclose` field from the daily `chart()` result for benchmark total-return math; fall back to `close` if it is missing.
- Benchmarks: `SPY` for Athena, `AGG` for Arch (they track the S&P 500 and the Bloomberg US Aggregate and have live Yahoo data; `^GSPC` is price-only). Show the benchmark name from `funds.benchmark_name` in the UI, not the ticker.
- Rates strip for Arch: `^IRX` (13-week), `^FVX` (5y), `^TNX` (10y), `^TYX` (30y). Values are yields in percent.
- Search: `search(q)` for the pitch editor and the add-holding form.
- Rate limits: none published. Keep total Yahoo calls per page under 3 by batching. If the library starts failing (Yahoo changes its API a few times a year), bump the package version first; the maintainer usually patches within days.

### 13.2 Treasuries (automated, free)

Daily cron fetches the Treasury par yield curve XML for the current year, upserts today's row into `treasury_curve` (tenors 1m through 30y). `src/lib/bonds/treasury.ts`:

- `priceTreasury(holding, curveDate)`: interpolate the par yield at the bond's remaining maturity (linear between tenors), then price = present value of remaining semiannual coupons and principal discounted at that yield (semiannual compounding, ACT/ACT). Return clean price per 100, accrued interest, YTM (= the interpolated yield), modified duration. Label the price source "curve" in the UI.
- Pricing a Treasury off the par curve rather than its own quote is an approximation, usually within a few cents. Say so in a tooltip. The PM can override any Treasury with a manual mark.

### 13.3 Corporates, agency MBS, municipals (manual plus estimate)

There is no free, licensed, per-CUSIP price API. FINRA TRACE is the source of record but its public site is web-lookup only under non-commercial terms, and its developer API needs organizational onboarding. Paid options with a clean API: Finnhub (bond price and TRACE tick endpoints, paid tiers), EODHD (US corporate bonds, add-on), Xignite, QUODD, Cbonds (enterprise). So:

- `pricing_method = 'manual'`. The Arch PM enters a mark from the Bloomberg terminals in the Benn Capital Markets Lab, weekly, via "Enter mark" or the CSV upload. Each mark stores clean price, YTM, duration, source, who, when.
- Between marks, `src/lib/bonds/estimate.ts` produces an estimated price: take the last mark, compute the change in the Treasury par yield at `holdings.benchmark_tenor` since the mark date, and apply `estimated_price = last_price * (1 - duration * delta_yield)`. Label it "est." with the mark date. This keeps daily fund snapshots moving with rates without pretending to be a quote.
- Accrued interest is always computed: `face * coupon / frequency * (days since last coupon / days in period)` using the holding's `day_count` (30/360 for corporates and munis, ACT/ACT for Treasuries, ACT/360 for money market). Market value = (clean price + accrued per 100) / 100 * face.
- Stale marks: a mark older than 7 days flags the holding on the dashboard and in the PM checklist, and the daily cron emails the Arch PM a list. The threshold is a fund setting.
- Agency MBS: treat pool factor as part of `quantity` (current face). The PM updates current face monthly when the factor changes; add a `cash_movements` row of kind `interest`/`adjustment` for paydowns. Do not build factor modeling.
- Every bond holding page links to FINRA's public bond lookup for its CUSIP so students can eyeball TRACE prints.

### 13.4 Provider interface

`src/lib/bonds/providers.ts` defines:

```ts
interface BondPriceProvider {
  name: string;
  getPrice(input: { cusip?: string; isin?: string; asOf?: Date }): Promise<{ cleanPrice: number; ytm?: number; asOf: Date; source: string } | null>;
}
```

Ship `ManualMarkProvider` (reads `bond_marks`), `TreasuryCurveProvider`, and a `FinnhubProvider` stub that throws "not configured" unless `FINNHUB_API_KEY` is set. `pricing_method` picks the provider; a future paid feed is one new class and one new enum value.

### 13.5 Fund valuation

`src/lib/valuation.ts` exposes `valueFund(fundId, asOf?)` returning per-holding price, source, accrued, market value, weight, unrealized gain, and fund totals (securities, cash, total, day change). Every page and the daily snapshot use this one function. Day change for the fund is the sum of holding day changes (GBH's geometric approach applied per position, not to the total).

### 13.6 Scheduled jobs (`vercel.json`, all daily, times in UTC)

| Route | Schedule | Does |
|---|---|---|
| `/api/cron/treasury-curve` | `30 21 * * 1-5` | Fetch and upsert today's par curve. |
| `/api/cron/eod-snapshot` | `45 21 * * 1-5` | For each fund: `valueFund()`, benchmark close and adjusted close via `chart()`, insert `fund_snapshots`. |
| `/api/cron/votes` | `0 6 * * *` | Close expired votes, send reminders for votes closing within 24h. |
| `/api/cron/stale-marks` | `0 12 * * 1` | Email Arch PM the stale mark list. |
| `/api/cron/backup` | `0 8 * * *` | Full Sheets backup (Section 15). |

All cron routes check `Authorization: Bearer ${CRON_SECRET}` (Vercel sets it) and return 401 otherwise. Each writes a row to `audit_log` with `actor_id = null` and `action = 'cron.<name>'`.

Hobby plan runs daily jobs within a one-hour window; nothing here needs to be exact. The market-hours quote cache handles intraday.

---

## 14. Performance and analytics

- Period returns come from `fund_snapshots.total_value` adjusted for external cash flows: use a simple daily time-weighted return (`(V_t - CF_t) / V_{t-1} - 1`, chain-linked), where `CF_t` is the sum of `cash_movements` of kind contribution/withdrawal that day. Benchmark returns from `benchmark_adj_close`.
- Show MTD, QTD, YTD, LTM, 3Y (annualized), since inception, same layout as the SMIF newsletter table (fund vs benchmark, difference).
- Sector allocation vs benchmark: SMIF weight from `valueFund()`, benchmark weight from the latest `sector_targets.benchmark_weight_pct` (entered by Equity Strategies / Macro, typically monthly from Bloomberg or the S&P/Bloomberg factsheets). Do not try to derive S&P sector weights from Yahoo.
- Attribution (v2, after Phase 4): contribution to return by sector = sum over holdings of start weight x holding return.
- Arch analytics: weighted modified duration, weighted YTM, allocation by instrument type and by rating bucket, curve chart from `treasury_curve` (2y, 5y, 10y, 30y over time), spread vs Treasury at each mark for corporates.
- Risk (from GBH `risk.ts`): volatility, max drawdown, beta vs benchmark, concentration (top 5, top 10 weight). Keep.
- Backfill: when the app launches, snapshots start that day. Provide `/[fund]/admin/holdings` "Import snapshot history CSV" (`date,total_value,cash`) so officers can paste historical monthly values from old newsletters to extend the chart.

---

## 15. Google Sheets backup

Mechanism copied from GBH `/api/admin/backup`: `googleapis` with a service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`), the sheet shared with the service account as editor, `spreadsheets.values.clear` then `update` per tab, bold frozen header row, number formats from `sheets-format.ts`.

One spreadsheet titled "SMIF Hub - Backup". Tabs:

| Tab | Content |
|---|---|
| `README` | What this sheet is, when it last ran, who owns the service account, "do not edit, the app overwrites nightly". |
| `Athena Holdings`, `Arch Holdings` | Active and closed holdings with all columns plus latest price, source, market value, weight. |
| `Athena Trades`, `Arch Trades` | Full ledger. Also appended in real time on execute (append one row; the nightly run rewrites the whole tab so the two never drift). |
| `Athena Tickets`, `Arch Tickets` | Pending and cancelled tickets. |
| `Athena Pitches`, `Arch Pitches` | Every pitch with status, result, votes yes/no, percent, dates, author, sector. |
| `Votes` | pitch id, voter name, choice, cast time (officer-visible data; the sheet is officer-only). |
| `Bond Marks` | All marks. |
| `Fund Snapshots` | Daily values and benchmark. |
| `Sector Targets` | History. |
| `Members` | Every membership across years: name, email, fund, year, role, sector, leader, status. No passwords, no auth ids. |
| `Sectors`, `Funds`, `Academic Years`, `Cash Movements`, `Meetings`, `Attendance`, `Updates` | Straight dumps. |
| `Audit Log` | Last 5,000 rows. |
| `Backup Runs` | History of runs. |

Also write a JSON export of every table to Supabase Storage bucket `backups/YYYY-MM-DD.json.gz` in the same run, so a restore does not depend on parsing a spreadsheet. Keep 90 days.

"Run backup now" button on `/admin` for officers, with the last run's status and row count next to it. Failures email app admins.

Sheet ownership: create the Google Sheet under a SMIF-owned Google account (not a student's), and document the service account in `HANDOVER.md`.

---

## 16. Email (Resend)

From address: `SMIF Hub <noreply@{verified domain}>`. Reply-to: the fund's president (setting). Plain, branded template with the fund accent. Every email has a direct link into the app.

| Event | To |
|---|---|
| Invite (Supabase template via SMTP) | new member |
| Password recovery (Supabase template via SMTP) | member |
| Admin set a temporary password | member |
| Pitch submitted | fund officers |
| Vote opened | eligible voters of the fund |
| Vote reminder (24h, 3h) | non-voters |
| Vote closed with result | fund members |
| Ticket ready | fund PM, faculty advisor |
| Trade executed | fund members |
| Stale bond marks (weekly) | Arch PM |
| Roster import summary | importing officer |
| Backup failed | app admins |
| New update posted | fund members (optional per update) |

Members can mute non-essential emails (updates, reminders) on `/profile`; vote opened, vote result, and trade executed are always sent.

Supabase Auth SMTP settings: host `smtp.resend.com`, port `465`, user `resend`, password = Resend API key, sender = the same from address, on a domain verified in Resend. Customize the Supabase email templates (invite, recovery, email change) with the SMIF name and app URL.

---

## 17. In-app administration (no code required for turnover)

### 17.1 Roster import

CSV or pasted rows, one row per person per fund:

```
email,full_name,fund,role,sector,is_sector_leader,title_override
lfuselier@uga.edu,Lucy Fuselier,athena,vice_president,,false,
lfuselier@uga.edu,Lucy Fuselier,arch,sector_leader,Treasuries,true,
jstevens@uga.edu,Joshua Stevens,athena,sector_leader,Communication Services,true,
jstevens@uga.edu,Joshua Stevens,arch,sector_leader,Industrials,true,
```

Rules: `fund` in `athena|arch`; `role` from the enum; `sector` matched case-insensitively to the fund's sectors (error if unknown); email domain must be allowed. Preview screen shows creates, updates, and errors per row before committing. Commit: create auth user + profile if new (send invite), upsert membership for the current year, log to `roster_imports`. Existing members keep their password. The same person appearing in both funds gets one auth user and two memberships.

Export the current roster in the same format so next year's officers start from it.

### 17.2 Academic year rollover

`/[fund]/admin/year` (visible in both funds, acts on both): "Start 2027-28". Confirmation lists what happens: all `active` memberships in the current year become `alumni` (read-only), a new `academic_years` row becomes current, officers are prompted to import the new roster. Alumni keep login and can read everything their fund did while they were in it plus the current dashboard (setting `settings.alumni_can_view_current`, default true). Nothing is deleted.

### 17.3 Everything else

Sectors, targets, vote threshold, quorum, vote window, benchmark symbol, email domains, meeting day, pitch templates, and stale-mark threshold are all edited in-app by officers. The only things that need a developer are new instrument types, new pages, and provider integrations.

### 17.4 HANDOVER.md

Even though the students will not maintain code, write a short `HANDOVER.md`: what the app is, the accounts involved (GitHub, Vercel, Supabase, Resend, Google service account, the backup sheet), where secrets live, how to add an app admin, how to run a backup, how to restore from the JSON backup, and who to call.

---

## 18. Seed data (real securities, fake amounts)

Write `scripts/seed.ts` (run with `npm run seed`, idempotent). It creates the two funds, the 2026-27 academic year, the sectors, placeholder users, and holdings. For each equity/ETF it fetches the live price at seed time and sets `quantity = round(target_weight * fund_total / price)` and `avg_cost = price * random(0.80, 0.98)`, so the amounts are fake but internally consistent. Do not commit real student names or emails; the real roster comes in through the import.

### Funds

| slug | name | asset_class | benchmark | total for seeding | threshold |
|---|---|---|---|---|---|
| athena | Athena Stock Fund | equity | SPY / S&P 500 | $4,500,000 | 60 |
| arch | Arch Bond Fund | fixed_income | AGG / Bloomberg US Aggregate | $2,000,000 | 60 |

### Sectors

Athena (in this order): Equity Strategies (strategy team), Communication Services, Consumer Discretionary, Energy & Utilities, Financial Institutions Group, Healthcare, Industrials, REITs & Materials, Staples, Technology.

Arch: Macro (strategy team), Treasuries, Financials, Industrials, Utilities, Tactical Opportunities.

### Placeholder users

One app admin (Ryan, `ryan@rmh.productions`, both funds), one faculty advisor (`advisor@example.com`), and for each fund: president, vice president (Arch: two co-presidents), PM, alumni relations (Athena only), one sector leader and two analysts per sector, all `@example.com` with obviously fake names like "Athena Healthcare Leader". Give two placeholder people memberships in both funds with different roles so the switcher and per-fund permissions can be tested.

### Athena holdings

Names below were published as SMIF holdings or trades in the Q4 2023 and Q3 2024 newsletters. Weights are made up to roughly match the fund's published sector allocation (Technology ~31%, Financials ~12.5%, Healthcare ~12%, Communication Services ~10%, Industrials ~9%, Consumer Discretionary ~8%, Staples ~7%, Energy & Utilities ~5%, REITs & Materials ~5%). Sector ETFs marked "placeholder" stand in for names not published; the PM replaces them.

| Sector | Symbol | Name | Weight |
|---|---|---|---|
| Technology | AVGO | Broadcom | 8.0 |
| Technology | ANET | Arista Networks | 6.0 |
| Technology | NOW | ServiceNow | 5.0 |
| Technology | CRM | Salesforce | 5.0 |
| Technology | FTNT | Fortinet | 4.0 |
| Technology | XLK | Technology Select Sector SPDR (placeholder) | 2.7 |
| Financial Institutions Group | MCO | Moody's | 4.5 |
| Financial Institutions Group | AON | Aon | 4.0 |
| Financial Institutions Group | XLF | Financial Select Sector SPDR (placeholder) | 4.0 |
| Healthcare | HCA | HCA Healthcare | 3.0 |
| Healthcare | ZTS | Zoetis | 2.5 |
| Healthcare | AZN | AstraZeneca | 2.5 |
| Healthcare | LH | Labcorp | 1.8 |
| Healthcare | STE | Steris | 1.5 |
| Healthcare | FTRE | Fortrea | 1.0 |
| Communication Services | META | Meta Platforms | 5.5 |
| Communication Services | CMCSA | Comcast | 2.5 |
| Communication Services | MSGS | Madison Square Garden Sports | 2.0 |
| Industrials | GD | General Dynamics | 2.5 |
| Industrials | RTX | RTX | 2.0 |
| Industrials | DE | Deere | 1.8 |
| Industrials | WM | Waste Management | 1.5 |
| Industrials | BLDR | Builders FirstSource | 1.0 |
| Consumer Discretionary | MCD | McDonald's | 3.0 |
| Consumer Discretionary | SBUX | Starbucks | 2.0 |
| Consumer Discretionary | LEN | Lennar | 2.0 |
| Consumer Discretionary | XLY | Consumer Discretionary Select Sector SPDR (placeholder) | 1.3 |
| Staples | WMT | Walmart | 3.0 |
| Staples | MDLZ | Mondelez | 2.2 |
| Staples | DG | Dollar General | 1.7 |
| Energy & Utilities | NEE | NextEra Energy | 2.5 |
| Energy & Utilities | XLE | Energy Select Sector SPDR (placeholder) | 2.5 |
| REITs & Materials | MLM | Martin Marietta Materials | 2.0 |
| REITs & Materials | OHI | Omega Healthcare Investors | 1.5 |
| REITs & Materials | WPC | W. P. Carey | 1.5 |
| Cash | | | 0.5 |

Normalize weights to 100 in the script. Also seed a few `trades` rows dated in the past (the GD buy / XLI sell and the OHI buy / MLM trim from the Q3 2024 newsletter) so the ledger and position history are not empty, and two closed pitches (General Dynamics passed 78%, Ares Capital failed 23%) plus one open vote.

### Arch holdings

Allocation follows the fund's published mix. Issuers are real; coupons, maturities, and CUSIPs are placeholders the Arch PM replaces on day one (the import form makes this a five-minute job).

| Sector | Type | Name | Pricing | Weight |
|---|---|---|---|---|
| Macro | etf | AGG, iShares Core U.S. Aggregate Bond ETF | live | 59.7 |
| Macro | agency_mbs | UMBS 30-year 5.5% pool (placeholder pool) | manual | 10.0 |
| Macro | agency_mbs | GNMA II 30-year 5.0% pool (placeholder pool) | manual | 7.0 |
| Treasuries | treasury | US Treasury 10-year note (placeholder issue) | treasury_curve | 5.0 |
| Treasuries | treasury | US Treasury 2-year note (placeholder issue) | treasury_curve | 2.8 |
| Utilities | corporate | Duke Energy senior note (placeholder terms) | manual | 5.0 |
| Financials | corporate | JPMorgan Chase senior note (placeholder terms) | manual | 5.0 |
| Industrials | corporate | Caterpillar Financial senior note (placeholder terms) | manual | 4.4 |
| Cash | money_market | Money market sweep | live (1.00) | 1.1 |

For each manual bond seed one `bond_marks` row dated last Friday at a plausible price (98 to 102), with `benchmark_tenor` set (10 for the utility and financial, 5 for Caterpillar, 7 for the MBS) and `duration` filled so the estimate logic has something to work with. Seed 30 days of `treasury_curve` from the live feed.

---

## 19. Build phases and acceptance criteria

Each phase ends with a PR to `main`, a Vercel preview, and a short report. Do not start the next phase until the previous one's criteria pass.

### Phase 0: Foundation

Repo, Next.js, Tailwind, Supabase project, `0001_init.sql`, RLS helpers and policies, `profiles` trigger, `permissions.ts`, seed script, CI running `tsc`, `eslint`, and tests.

Done when: `npm run seed` builds both funds; a policy test suite (run with the Supabase local stack or against a test project) proves that an analyst cannot insert a `trades` row, a sector leader cannot submit another sector's pitch, an Arch PM cannot execute in Athena, and a faculty advisor can execute in both.

### Phase 1: Auth, roster, switcher, Athena dashboard

Login, invite flow, both password resets, `/no-access`, middleware, fund switcher, `/athena` dashboard, holdings, holding detail, sectors, team, profile. Live quotes with cache and fallback. Roster import and export. Members admin page.

Done when: a fresh user imported from CSV receives an invite, sets a password, lands on the right fund, sees live prices; an officer can reset that user's password both ways; a user on both rosters sees different roles in each fund.

### Phase 2: Arch and bond pricing

Bond fields, marks, CSV upload, Treasury curve cron, curve pricing, estimates, accrued interest, stale flags, Arch dashboard extras (duration, YTM, rates strip, curve chart), provider interface.

Done when: the seeded Arch fund values correctly with a mix of live, curve, and manual prices; changing a mark changes the total; a Treasury priced off the curve is within $1 per 100 of a hand calculation in the test; a stale mark shows on the checklist.

### Phase 3: Pitch to trade

Pitch editor with uploads, submit/schedule/open/close, voting UI and tally, `close_pitch_vote`, tickets, `execute_ticket`, ledger, cash movements, all related emails, audit log.

Done when: the full path draft to executed works in the browser for both funds; a 59% vote fails and a 60% vote passes; a non-PM cannot see the execute button and gets 403 if they call the route; a corrected trade appears as a reversal row and cash reconciles.

### Phase 4: Operations

EOD snapshots, performance page and returns table, Sheets backup with all tabs plus JSON export, real-time trade append, updates, attendance, academic year rollover, settings page, `/admin` health page, `HANDOVER.md`.

Done when: after two nightly runs the performance chart has two points and the sheet has every tab with the right row counts; rolling the year makes last year's members read-only and leaves their history intact.

### Phase 5: Polish

Mobile pass on every page, empty states, PWA, accessibility (keyboard nav, contrast), Lighthouse performance over 90 on the dashboard, sector attribution, CSV exports, final review against the permission matrix.

---

## 20. Non-goals (for now)

- Placing orders with a broker. The app records what the PM did with the broker.
- Per-student money, NAV units, contributions, Stripe. SMIF is Foundation capital.
- Options, futures, FX, crypto.
- Real-time streaming quotes. Five-minute cache is plenty for a fund that trades after a weekly class.
- MBS factor modeling, prepayment models, OAS.
- Bloomberg or FactSet integration. Marks come in by hand or CSV.
- Public marketing site. The Terry College page stays the public face.

---

## 21. Decisions log

Made by Ryan on 2026-09-15:

| Question | Decision |
|---|---|
| One app or two | One app, fund switcher, memberships and roles per fund. |
| Who can execute trades | The fund's Portfolio Manager and the faculty advisor. App admin can too (support and break-glass), always audit-logged. |
| Workflow scope | Full pitch, vote, and execute in-app. |
| Reference project | https://github.com/rmhwebsites/GBH |
| Auth | Supabase Auth, email + password, password reset at user level and admin level. No Google sign-in. |
| Bond pricing | Researched. Free per-CUSIP corporate and MBS prices do not exist with clean licensing. Use live prices for ETFs and money market, Treasury par curve pricing for Treasuries, manual marks plus duration-based estimates for everything else, behind a provider interface so a paid feed can be added later. |
| Turnover | Roster CSV upload plus in-app admin for sectors, roles, thresholds, settings. Short HANDOVER.md, not a full student code handover. |
| Vote rule | Yes/No, passes at 60% of votes cast, threshold per fund, quorum optional. |
| Amounts | Fake dollar amounts, real securities, for seed data. |

Open (ask Ryan before building the piece that depends on it):

1. Domain and sending domain: is this `smifuga.com` (the Arch analyst on ZoomInfo used an `@smifuga.com` address) or a subdomain of something Ryan owns? Needed for Resend verification and Supabase redirect URLs.
2. Faculty advisor email and whether trustees/donors get `viewer` accounts.
3. Should the sector of the pitch be allowed to vote on its own pitch (default yes, as the class does today)?
4. Real current holdings: the seed is from public newsletters; the first roster import and holdings import replace it. Who on the student side owns that on day one?
5. Vercel plan: Hobby is fine for this spec. Confirm whether the deployment sits in Ryan's account or a SMIF-owned account.

---

## 22. Environment variables and repo layout

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# App
NEXT_PUBLIC_APP_URL=https://hub.example.com
CRON_SECRET=                      # Vercel sets this for cron invocations; set the same value locally
BOOTSTRAP_ADMIN_EMAILS=ryan@rmh.productions   # seeded as is_app_admin on first run only

# Resend
RESEND_API_KEY=
EMAIL_FROM="SMIF Hub <noreply@your-verified-domain>"

# Google Sheets backup
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=               # escaped newlines, see GBH backup route
GOOGLE_SHEET_ID=

# Optional
FINNHUB_API_KEY=                  # enables FinnhubProvider for bond prices
```

```
src/
  app/
    (auth)/login, auth/set-password, auth/reset, auth/change-password, no-access
    [fund]/
      page.tsx (dashboard), holdings/, sectors/, pitches/, votes/, trades/,
      performance/, updates/, team/, attendance/, profile/
      admin/ (tickets, holdings, pitches, sectors, members, year, settings, updates, attendance, audit)
    admin/ (app admin)
    api/
      cron/ (treasury-curve, eod-snapshot, votes, stale-marks, backup)
      [fund]/ (portfolio, holdings, pitches, votes, tickets, trades, sectors, members, settings, marks)
      market/ (quotes, history, search, rates)
      auth/ (admin-reset, set-temp-password)
      admin/ (backup, health, users)
  components/ (charts, tables, pitch, vote, layout, ui)
  lib/
    supabase/ (server.ts, client.ts, service.ts, middleware.ts)
    permissions.ts
    yahoo.ts
    bonds/ (treasury.ts, estimate.ts, accrued.ts, providers.ts)
    valuation.ts
    performance.ts
    emails/ (templates, send.ts)
    sheets/ (backup.ts, format.ts)
    audit.ts
  types/ (database.ts generated by `supabase gen types`, domain.ts)
supabase/
  migrations/0001_init.sql, ...
  seed/ (seed.ts helpers)
scripts/ (seed.ts, export-roster.ts)
tests/ (permissions, bonds, valuation, close-vote)
HANDOVER.md
```

Conventions: TypeScript strict, no `any` outside the Yahoo adapter, Zod on every route input, one `route.ts` per resource, server components by default, client components only for charts, forms, and the vote panel. Commit messages: conventional commits. Every PR includes a "Permission matrix impact" line.

---

## 23. Sources used for this spec

- SMIF page: https://www.terry.uga.edu/current-students/student-orgs/smif/
- SMIF members page (roles and sectors, both funds): https://www.terry.uga.edu/current-students/student-orgs/smif/members/
- SMIF Info Session deck, March 2026 (class structure, vote process, Arch allocation): https://www.terry.uga.edu/wp-content/uploads/SMIF-Info-Session-Presentation.pdf
- SMIF Q3 2024 newsletter (holdings, sector allocation vs S&P, vote results): https://www.terry.uga.edu/wp-content/uploads/smif-q3-24-newsletter.pdf
- SMIF Q4 2023 newsletter (holdings, vote results): https://www.terry.uga.edu/wp-content/uploads/smif-q4-23-newsletter.pdf
- SMIF 2023-24 overview (60% vote threshold, trade sizes): https://www.terry.uga.edu/wp-content/uploads/uga-smif-tmo-sp2024.pdf
- Arch Bond Fund launch article: https://www.terry.uga.edu/arch-bond-fund-gives-terry-college-students-new-learning-experience/
- A decade of SMIF (custodian, broker, Bloomberg lab): https://www.terry.uga.edu/student-managed-investment-fund/
- GBH reference repo: https://github.com/rmhwebsites/GBH
- yahoo-finance2: https://github.com/gadicc/yahoo-finance2
- Supabase RBAC and RLS guidance: https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac
- Supabase custom SMTP with Resend: https://resend.com/docs/send-with-supabase-smtp and https://supabase.com/docs/guides/auth/auth-smtp
- Vercel cron limits (Hobby once per day, hourly precision): https://vercel.com/docs/cron-jobs/usage-and-pricing
- US Treasury daily par yield curve XML feed: https://home.treasury.gov/treasury-daily-interest-rate-xml-feed
- FINRA fixed income data (public lookup, non-commercial): https://www.finra.org/finra-data/fixed-income
- FINRA developer API (fixed income datasets, org onboarding): https://developer.finra.org/docs#query_api-fixed_income
- Finnhub bond price API (paid): https://finnhub.io/docs/api/bond-price
- EODHD US corporate bonds API: https://eodhd.com/financial-apis-blog/us-corporate-bonds-fundamentals-and-historical-api

