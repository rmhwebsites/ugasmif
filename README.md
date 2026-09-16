# SMIF Hub

The internal web app for the UGA Student Managed Investment Fund: the Athena
Stock Fund (equities, S&P 500 benchmark) and the Arch Bond Fund (fixed income,
Bloomberg US Aggregate benchmark).

It is the place where the class does its work between meetings. Members see
holdings, performance and sector allocation; analysts write pitches and vote on
them after class; the portfolio manager turns a passed pitch into a trade
ticket and records the fill; officers run the roster, post updates and take
attendance. The app records and controls the process. It never places orders
with the broker.

The same student can hold different roles in each fund, so every permission
check is scoped to one fund. That rule shapes the whole data model.

## Stack

- Next.js 16 (App Router, server components by default) and React 19
- TypeScript in strict mode
- Supabase: Postgres with row level security, Supabase Auth, Storage
- Tailwind CSS 4
- Market data: Yahoo Finance (`yahoo-finance2`) for equities and ETFs, the US
  Treasury par yield curve feed for Treasuries, manual marks plus an estimate
  for corporates and agency MBS
- Email through Resend, nightly backup to Google Sheets and Supabase Storage
- Vitest for unit tests, deployed on Vercel

## Quick start

You need Node 22 or newer and a Supabase project.

```bash
npm install
cp .env.example .env.local     # then fill it in, see below
node scripts/apply-migrations.mjs
npm run seed
npm run dev
```

The app runs at http://localhost:3000.

### Environment variables

Copy `.env.example` to `.env.local` and fill in at least these:

| Variable | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL from Supabase, Settings, API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same key under its legacy name, for tooling that still expects it |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key (`sb_secret_…`). Server only. Crons, roster import, backup and the seed script need it |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` locally, the real URL in production |
| `CRON_SECRET` | Any long random string. Vercel sends it to the cron routes as a bearer token |
| `BOOTSTRAP_ADMIN_EMAILS` | Comma-separated. The first one is seeded as the app admin |

Optional but needed for the matching feature: `RESEND_API_KEY` and
`EMAIL_FROM` (email), `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY` and
`GOOGLE_SHEET_ID` (the nightly Sheets backup), `FINNHUB_API_KEY` (an extra bond
price provider). `SUPABASE_DB_URL` or `SUPABASE_ACCESS_TOKEN` is what
`scripts/apply-migrations.mjs` uses to reach the database.

`SETUP.md` walks through the Supabase, Resend, Google and Vercel setup in
order, including the email templates you have to change by hand.

### Migrations

`node scripts/apply-migrations.mjs` applies everything in
`supabase/migrations/` and records what it applied in a `schema_migrations`
table, so rerunning is safe. It connects over `SUPABASE_DB_URL` with `psql`
when it can and falls back to the Supabase Management API over HTTPS. If
neither works, paste the files into the SQL editor in the Supabase dashboard in
filename order.

### Seed data

`npm run seed` fills an empty project with both funds, the 2026-27 academic
year, the sectors, placeholder people, holdings, 30 days of Treasury curve,
some historical trades and a few pitches (SPEC Section 18). The securities are
real and the prices are live at seed time; the amounts, the people and the bond
terms are made up. Every placeholder is named so you can tell, for example
"Athena Healthcare Leader".

All placeholder accounts use the password `smif-demo-2026!`. Sign in as
`athena.pm@example.com` to see the PM tools, as `athena.president@example.com`
for the officer tools, or as the address in `BOOTSTRAP_ADMIN_EMAILS` for the
app admin. Two placeholder people sit in both funds with different roles, which
is the case the fund switcher exists for.

The seed is idempotent, but it resets seeded quantities, cash balances and fund
settings to their seed values. Do not run it against a fund that holds real
positions.

`npm run export-roster > roster.csv` dumps the current year's memberships for
both funds in the roster import format (SPEC 17.1).

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Vitest, everything in `tests/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run seed` | Seed data (SPEC 18) |
| `npm run export-roster` | Roster CSV to stdout |

## Project structure

```
src/
  app/
    [fund]/            one folder per fund route: dashboard, holdings, sectors,
                       pitches, votes, trades, performance, updates, team,
                       attendance, profile, and admin/ for officers and the PM
    admin/             app admin only: global flags, backup, health
    api/               route handlers ([fund]/…, market/…, cron/…, auth/…, admin/…)
    auth/              set-password, reset, change-password, confirm
  components/          charts, tables, pitch and vote UI, layout, ui kit
  lib/
    permissions.ts     the permission matrix, in one place
    fund.ts            fund context: who is asking, about which fund
    supabase/          server, client and service-role clients
    yahoo.ts           quotes, history, search, with a two-layer cache
    bonds/             accrued interest, Treasury curve, mark estimates
    valuation.ts       prices every holding and totals the fund
    performance.ts     time-weighted returns, drawdown, risk
    emails/, sheets/, audit.ts, csv.ts, format.ts
  types/domain.ts      row types that mirror the schema
  proxy.ts             session refresh and the auth gate (Next 16 middleware)
supabase/migrations/   0001_init.sql (schema, RLS, functions), 0002_storage.sql
scripts/               apply-migrations.mjs, seed.ts, export-roster.ts
tests/                 permissions, bonds, performance, close-vote, service-role guard
```

A few conventions worth knowing before you change anything:

- Permissions live in `src/lib/permissions.ts` and are mirrored by the RLS
  helper functions in the migration. Change one, change the other in the same
  commit, and update `tests/permissions.test.ts`.
- The service-role client bypasses RLS. It is allowed in cron routes, the auth
  admin routes, `api/admin`, the roster import, the add-member route and the
  year rollover, and nowhere else. `tests/service-role-guard.test.ts` enforces
  that.
- Route handlers resolve `getFundContext(slug)` first, then check `can()`, then
  do the work. Every request body is parsed with Zod.
- Money is `numeric` in Postgres and can arrive as a string. Coerce with
  `Number()` where the math happens.

## Documentation

- `SPEC.md` — what the app is and why, in detail: data model, permission
  matrix, pitch and trade flow, market data, backups, seed data
- `SETUP.md` — standing up Supabase, Resend, Google and Vercel from scratch
- `HANDOVER.md` — the short version for whoever runs this after us: accounts,
  secrets, backups, who to call
- `CONTRACTS.md` — the module interfaces each part of the code exposes
