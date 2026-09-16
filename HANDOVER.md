# SMIF Hub handover

For whoever is responsible for keeping this running. You do not need to write
code to run it. You do need to know where the accounts are, where the secrets
live, and how to get the data back if something goes badly wrong.

## What this is

SMIF Hub is the internal web app for the UGA Student Managed Investment Fund:
the Athena Stock Fund and the Arch Bond Fund. It holds the portfolio, the
pitches, the votes, the trade ledger, the roster and the class updates.

It is a system of record and a workflow tool. It does not connect to a broker
and it never places an order. The UGA Foundation is still the custodian, the
PM still calls the trade in, and the app records what happened.

Almost everything officers need is in the app itself: sectors, targets, the
vote threshold and quorum, the vote window, benchmark symbols, allowed email
domains, meeting day, the roster, the academic year rollover. A developer is
only needed for new instrument types, new pages, or a new data provider.

## Accounts

Six accounts matter. Keep at least two people on each one, and keep this table
current with who has access.

| Account | What it holds | Who should own it |
|---|---|---|
| GitHub | The source code, at `ugasmif` | SMIF org or the faculty advisor, with Ryan as admin |
| Vercel | Hosting, environment variables, deploy logs, cron jobs | Same |
| Supabase | The database, authentication, file storage. This is the real asset | Same |
| Resend | Outbound email and the verified sending domain | Same |
| Google Cloud | The service account used by the nightly backup | A SMIF-owned Google account |
| Google Drive | The "SMIF Hub - Backup" spreadsheet | The same SMIF-owned account, shared with the service account as Editor |

The Google Sheet and the Cloud project must not sit in a student's personal
account. When a student graduates, their account goes away and the backup stops
silently.

## Where the secrets live

There is no secrets file in the repository. `.env.example` lists the names of
every variable and no values. `.env.local` holds the local values and is
gitignored.

The live values are in **Vercel, Project Settings, Environment Variables**.
That is the source of truth for production. If you need a value again, read it
there rather than regenerating it.

What each one is:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` — safe to expose, they are in the browser
  bundle already. Row level security is what protects the data.
- `SUPABASE_SERVICE_ROLE_KEY` — the secret key. It bypasses every security
  rule in the database. Treat it like the database password. Server side only.
- `CRON_SECRET` — the bearer token the scheduled jobs present.
- `RESEND_API_KEY` — sends email, and is also the SMTP password configured in
  Supabase, Authentication, Emails.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID` —
  the backup writer.
- `EMAIL_FROM`, `NEXT_PUBLIC_APP_URL`, `BOOTSTRAP_ADMIN_EMAILS` — not secret,
  but changing them changes behaviour.

If a key leaks: rotate it at the source (Supabase Settings API, Resend API
Keys, or a new Google service account key), update Vercel, and redeploy. For
the Supabase secret key, also check the audit log in the app for anything you
did not do.

`SETUP.md` explains where each value comes from if you are standing up a fresh
environment.

## How to add an app admin

An app admin sees both funds and every admin tool, and every action they take
is audit logged. They never vote; admins are not students.

1. The person must already have an account. If they do not, add them to a
   roster in `/[fund]/admin/members` first so they get an invite email.
2. Sign in as an existing app admin and go to `/admin`.
3. Find them in the list and turn on **App admin**. The same screen has the
   **Faculty advisor** flag, which grants read access to both funds plus trade
   execution, updates and attendance, but not roster editing.

Only an app admin can grant app admin, and nobody can remove their own flag, so
there is always at least one left.

If every app admin is gone and nobody can sign in to grant it, set the flag
directly in the database. In the Supabase SQL editor:

```sql
update public.profiles set is_app_admin = true where email = 'someone@uga.edu';
```

That is the break-glass path. It works because the SQL editor runs as the
database owner; the same update from the app would be refused.

## Backups

Two things run every night at 08:00 UTC (`/api/cron/backup`):

1. Every table is written to the Google Sheet "SMIF Hub - Backup", one tab per
   table. That sheet is for people to read. Do not edit it; the job overwrites
   it each night.
2. A gzipped JSON export of every table goes to the Supabase Storage bucket
   `backups`, named `YYYY-MM-DD.json.gz`. Exports older than 90 days are
   deleted. **This is the file a restore reads.**

The trade ledger tab also gets a row appended in real time whenever a ticket is
executed, so it is current between nightly runs.

### Run a backup by hand

Sign in as an app admin, go to `/admin`, and press **Run backup now**. The last
ten runs are listed under the button with their status and row counts. A
failure emails the app admins.

`/admin` itself is app-admin only, but the route behind the button,
`POST /api/admin/backup`, also accepts any current-year fund officer and the
faculty advisor, and `GET` on the same path returns the recent runs.

The nightly job is `/api/cron/backup`, protected by `CRON_SECRET`. To fire it
by hand from a terminal:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<your-app>/api/cron/backup
```

Check `/admin` weekly, or at least whenever you think about it. A backup that
has not run in a week means the cron or the Google credentials broke.

### Restore from the JSON backup

The JSON export is the data-level safety net. Supabase's own database backups
(Dashboard, Database, Backups) are the first thing to try, because they restore
logins as well as data. Use the JSON when you need to recover specific tables,
or when you are rebuilding into a new project.

1. In Supabase, Storage, `backups`, download the date you want and unzip it:

   ```bash
   gunzip -c 2026-09-15.json.gz > backup.json
   ```

2. The file looks like this:

   ```json
   {
     "exported_at": "2026-09-15T08:00:12.000Z",
     "app": "SMIF Hub",
     "tables": { "funds": [...], "memberships": [...], "trades": [...] }
   }
   ```

   Each key is a table name and each value is the full contents of that table
   as it was that night.

3. Make sure the schema exists in the target project: apply
   `supabase/migrations/` there first (`node scripts/apply-migrations.mjs`).

4. Load the tables in this order, so foreign keys resolve:

   `funds`, `academic_years`, `profiles`, `sectors`, `memberships`,
   `holdings`, `bond_marks`, `treasury_curve`, `fund_snapshots`,
   `sector_targets`, `pitches`, `pitch_files`, `votes`, `trade_tickets`,
   `trades`, `cash_movements`, `meetings`, `meeting_attendance`,
   `fund_updates`, `update_reads`, `roster_imports`, `backup_runs`,
   `price_snapshots`, `audit_log`.

   Insert with the service role key (it bypasses row level security) or from
   the SQL editor. Ids in the file are the original ones, so relationships come
   back intact.

5. One catch worth knowing before you need it: the export contains `profiles`,
   not the `auth.users` rows behind them, and `profiles.id` references
   `auth.users.id`. Restoring people into a **new** Supabase project therefore
   means recreating the auth users first (`auth.admin.createUser` with the same
   ids, or a roster import followed by matching the profiles up), or restoring
   the whole project from a Supabase backup instead. Restoring into the same
   project, where the auth users still exist, has no such problem.

6. Uploaded pitch decks and models live in the `pitch-files` storage bucket and
   are not in the JSON. Copy that bucket separately if you are moving projects.

If a restore is ever needed in anger, ask for help before running it. It is
much easier to recover from a bad day than from a bad restore.

## Routine things that go wrong

- **Nobody is getting email.** Check Resend's Logs tab. Usually the domain
  verification lapsed or the API key was rotated without updating Vercel and
  the Supabase SMTP settings.
- **Prices look stale.** Yahoo throttles sometimes. The app falls back to the
  last stored price and labels it stale, and recovers by itself.
- **Bond prices are old.** Corporates and agency MBS are priced from manual
  marks. The Arch PM enters them on `/arch/admin/holdings`. The Monday reminder
  email lists what has gone stale.
- **Someone cannot sign in.** An officer can send a reset link or set a
  temporary password from `/[fund]/admin/members/[id]`. Both are audit logged,
  and a temporary password forces a change at next login.

## Turnover each spring

1. An officer runs "Start 2027-28" on `/[fund]/admin/year`. Every active
   membership in the outgoing year becomes alumni (read only). Nothing is
   deleted.
2. Export the old roster (`/[fund]/admin/members`, or
   `npm run export-roster`), edit it, and import it for the new year.
3. Update this file: who holds which account, who the app admins are, who to
   call.

## Who to call

**Ryan — ryan@rmh.productions.** He built it and is the first app admin.

For anything account related, the SMIF faculty advisor is the other person who
should always have access.

The code is in the GitHub repo, and `SPEC.md` describes the whole system in
detail: data model, permission matrix, pitch and vote rules, market data,
backups. `SETUP.md` is the from-scratch setup guide. `README.md` is for the
next developer.
