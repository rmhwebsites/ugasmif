# Setting up SMIF Hub

Start to finish: a Supabase project, email through Resend, the Google Sheets
backup, and a Vercel deploy. Budget an hour the first time. Do the steps in
order, because later ones need values from earlier ones.

You need: Node 22 or newer, a Supabase account, a Resend account, a Google
account that the SMIF owns (not a student's), and a Vercel account connected to
the GitHub repo.

Keep a scratch file open for the values you collect. They all end up in
`.env.local` for local work and in Vercel's environment variables for
production.

## 1. Supabase project

1. Create a project at https://supabase.com/dashboard. Pick the region closest
   to Athens, Georgia (`us-east-1`). Save the database password somewhere safe;
   you cannot read it again.
2. Settings, API: copy the project URL and the publishable key
   (`sb_publishable_…`). Reveal and copy the secret key (`sb_secret_…`).
3. Settings, Database: copy the connection string if you want to apply
   migrations with `psql`.
4. Fill in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_…
SUPABASE_SERVICE_ROLE_KEY=sb_secret_…
SUPABASE_DB_URL=postgresql://…        # or SUPABASE_ACCESS_TOKEN=sbp_…
NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=<any long random string>
BOOTSTRAP_ADMIN_EMAILS=ryan@rmh.productions
```

The secret key is the service role. It bypasses row level security. It belongs
in `.env.local` and in Vercel, never in a client component and never in git.

## 2. Apply the migrations

```bash
node scripts/apply-migrations.mjs
```

The script applies every file in `supabase/migrations/` in filename order and
records what it applied in `public.schema_migrations`, so rerunning it is safe.
It tries `psql` against `SUPABASE_DB_URL` first, then the Supabase Management
API over HTTPS (that path needs `SUPABASE_ACCESS_TOKEN`, an `sbp_…` token from
https://supabase.com/dashboard/account/tokens). Add `--dry-run` to see what it
would do.

If neither path works from your machine, open the SQL editor in the dashboard
and paste the files in numeric order. Every migration is written to be safe to
run twice, so a partial attempt is recoverable.

What you get:

- `0001_init.sql`: every table, the `updated_at` triggers, the profile trigger
  that runs on new auth users, the RLS helper functions, the RLS policies, and
  the business functions `execute_ticket`, `close_pitch_vote` and `log_audit`.
- `0002_storage.sql`: the storage buckets. `pitch-files` (private, 25 MB cap,
  read access scoped to members of the fund in the first path segment) and
  `backups` (private, service role only). You do not create these by hand.
- `0003_onboarding.sql`: `first_name`, `last_name`, `phone` and `onboarded_at`
  on `profiles` (names are split out of any existing `full_name`), the public
  `avatars` bucket with a 2 MB cap and per-member write access, and the policy
  plus trigger that let a member set their own sector and nothing else.
- `0004_spec_fixes.sql`: `leads_strategy_team(fund)` so the Equity Strategies
  or Macro leader can set the whole fund's target weights,
  `is_any_roster_manager()` for the academic-year policies, `threshold_pct`
  and `quorum_pct` frozen onto each pitch so a settings change never rewrites
  a past result, and `pitch_vote_count(pitch)` so members can see how many
  ballots are in without seeing the split.
- `0005_alumni_view.sql`: `alumni_view_horizon(fund)`, which makes
  `settings.alumni_can_view_current` actually do something. With it off, an
  alumnus keeps the record of what the fund did while they were on the roster
  and stops seeing the live book.

Check it worked: Table editor should list `funds`, `memberships`, `holdings`
and the rest; Storage should list `pitch-files`, `backups` and `avatars`; and
`select onboarded_at from profiles limit 1` and
`select threshold_pct from pitches limit 1` should both run without error.

## 3. Auth settings

In Authentication, Sign In / Providers:

1. Email is enabled. Leave "Confirm email" on.
2. **Turn "Allow new users to sign up" off.** There is no public sign-up page
   and nobody should be able to create their own account. Accounts are created
   by the roster import or by an officer adding one person, both of which use
   the service role and are unaffected by this switch.
3. Optional: set a minimum password length of 8 and require lower, upper and
   digits.

In Authentication, URL Configuration:

- Site URL: `http://localhost:3000` while you are setting up, the production
  URL once you deploy. The email templates in the next step use it.
- Redirect URLs: add `http://localhost:3000/**` and `https://<your-domain>/**`.

## 4. Email through Resend

### 4a. The Resend account and domain

1. Create the account at https://resend.com under a SMIF-owned address.
2. Domains, Add Domain: use a domain or subdomain the SMIF controls, for
   example `smif.example.edu` or `mail.smif.example.edu`.
3. Add the DNS records Resend shows you: the DKIM `TXT` record, the SPF `TXT`
   (or `MX` for the return path) record, and a `DMARC` record if you do not
   have one. Verification usually takes a few minutes and sometimes an hour.
   Do not skip this. Unverified domains cannot send.
4. API Keys, Create API Key with sending permission. Copy it once; Resend will
   not show it again.

```
RESEND_API_KEY=re_…
EMAIL_FROM="SMIF Hub <noreply@your-verified-domain>"
```

`EMAIL_FROM` has to use the verified domain or Resend rejects the send. The app
uses this key directly for the emails it composes itself: invites, vote
reminders, updates, stale-mark nags, backup failures.

### 4b. Point Supabase at Resend over SMTP

Supabase sends its own emails (password recovery, and invites if you send one
from the dashboard). Its built-in sender is rate limited and not meant for
production, so give it Resend's SMTP:

Authentication, Emails, SMTP Settings, enable custom SMTP:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key (the same `re_…` value) |
| Sender email | an address on the verified domain, e.g. `noreply@your-domain` |
| Sender name | `SMIF Hub` |

The username really is the literal string `resend`. While you are in
Authentication, Rate Limits, raise the email rate limit above the default 2 per
hour or a roster import of 50 people will stall.

## 5. Email templates

This step is required, not cosmetic. The app handles Supabase email links at
`src/app/auth/confirm/route.ts`, which reads `token_hash` and `type` from the
query string, verifies the one-time token server side (so the session lands in
a cookie), and then forwards: `type=invite` goes to `/auth/set-password`,
`type=recovery` goes to `/auth/reset`, anything else goes to `/`. A bad or
expired token goes to `/login?error=link-expired`. The default Supabase
templates use `{{ .ConfirmationURL }}`, which is a different shape, so the
links have to be rewritten.

In Authentication, Emails, Templates, edit the link in each template:

**Invite user**

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite">
  Set your password
</a>
```

**Reset password**

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery">
  Reset your password
</a>
```

**Change email address**, if you use it:

```html
<a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change">
  Confirm your new address
</a>
```

You can add `&next=/some/path` to any of these to override where the user ends
up after the token is verified; only paths starting with `/` are accepted.

Because the link is built from `{{ .SiteURL }}`, the Site URL in step 3 has to
be the app's real URL. Test it: on `/login` use "Forgot password" with your own
address, follow the email, and check you land on `/auth/reset` signed in.

## 6. Google service account and the backup sheet

The nightly backup writes one tab per table into a Google Sheet, and a gzipped
JSON export of every table into the `backups` storage bucket. The sheet is for
humans; the JSON is what a restore reads.

1. In https://console.cloud.google.com create a project, for example
   "SMIF Hub Backup".
2. APIs and Services, Library: enable the **Google Sheets API**.
3. APIs and Services, Credentials, Create Credentials, Service account. Name it
   something obvious like `smif-hub-backup`. It needs no project roles.
4. On the service account, Keys, Add Key, Create new key, JSON. Download it.
   From that file you need `client_email` and `private_key`.
5. Create the spreadsheet in Google Drive under the SMIF-owned account, not a
   student's, and title it "SMIF Hub - Backup". Share it with the service
   account's `client_email` as **Editor**. The sheet ID is the long string in
   the URL between `/d/` and `/edit`.

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=smif-hub-backup@<project>.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=<the id from the sheet URL>
```

The private key has to stay on one line with literal `\n` escapes, wrapped in
double quotes. Copy it out of the JSON file exactly as it appears there.

If these three are missing the app still runs; the backup writes the JSON
export to storage and logs that Sheets is not configured.

## 7. Seed and first run

```bash
npm install
npm run seed
npm run dev
```

The seed creates both funds, the 2026-27 academic year, the sectors,
placeholder people, holdings with live prices, 30 days of Treasury curve, a few
historical trades and a few pitches. Everyone gets the password
`smif-demo-2026!`. Sign in as the address in `BOOTSTRAP_ADMIN_EMAILS` to get
the app admin view.

For a real launch, skip the placeholder people: sign in as the app admin, go to
`/[fund]/admin/members` and import the roster CSV (SPEC 17.1). The format is

```
email,full_name,fund,role,sector,is_sector_leader,title_override
```

and `npm run export-roster` prints the current roster in the same shape.

## 8. Deploy to Vercel

1. Vercel, Add New, Project, import the GitHub repo. Next.js is detected
   automatically. Node 22.
2. Settings, Environment Variables. Everything in `.env.example` that you
   filled in, for Production and Preview:

   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
     `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL` (the production URL)
   - `CRON_SECRET`
   - `RESEND_API_KEY`, `EMAIL_FROM`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_ID`
   - `FINNHUB_API_KEY` if you have one
   - `BOOTSTRAP_ADMIN_EMAILS` only matters when you run the seed

   `SUPABASE_DB_URL` and `SUPABASE_ACCESS_TOKEN` are for migrations from your
   machine. They do not belong in Vercel.
3. Deploy, then go back to Supabase, Authentication, URL Configuration and set
   the Site URL to the production URL and add it to the redirect list. Email
   links break if you forget this.
4. Vercel sets `CRON_SECRET` on its own cron invocations. Use the same value in
   the environment variables so the routes accept it.

### Cron jobs

`vercel.json` declares five scheduled jobs and each runs at most once a day,
which is what the Hobby plan allows. Hobby fires them within about an hour of
the stated time, and nothing here needs to be exact.

| Route | Schedule (UTC) | Does |
|---|---|---|
| `/api/cron/treasury-curve` | `30 21 * * 1-5` | Fetch today's par yield curve |
| `/api/cron/eod-snapshot` | `45 21 * * 1-5` | Value both funds, write `fund_snapshots` |
| `/api/cron/votes` | `0 6 * * *` | Close expired votes, remind about votes closing soon |
| `/api/cron/stale-marks` | `0 12 * * 1` | Email the Arch PM the stale bond marks |
| `/api/cron/backup` | `0 8 * * *` | Sheets backup plus the JSON export |

If Vercel rejects the deploy because the plan limits how many cron jobs a
project can have, keep `treasury-curve`, `eod-snapshot` and `votes`, and run
the other two by hand: backup has a button on `/admin`, and stale marks is only
a reminder email.

## 9. Check it works

- Sign in, switch funds with the switcher in the header.
- `/[fund]/holdings` shows prices. Bonds show a mark or an estimate, equities
  show a live quote.
- `/admin` (app admin) shows the health panel: Yahoo answering, curve fresh,
  last backup, Resend configured, Sheets configured.
- Press "Run backup now" on `/admin` and check the Google Sheet fills in and a
  `YYYY-MM-DD.json.gz` object appears in the `backups` bucket.
- Send yourself a password reset from `/login` and follow the link.

## Troubleshooting

**Emails do not arrive.** Check the Resend dashboard's Logs tab first; it shows
rejects with a reason. The usual causes are an unverified domain, an
`EMAIL_FROM` that does not match the verified domain, or Supabase's email rate
limit.

**A password link says "link expired" straight away.** Either the template
still uses `{{ .ConfirmationURL }}` (step 5) or the Site URL does not match the
site you opened the link on (step 3).

**Cron routes return 401.** `CRON_SECRET` differs between Vercel's invocation
and the environment variable. Set it explicitly in both.

**Holdings show stale prices.** Yahoo is rate limiting or down. The app falls
back to the last row in `price_snapshots` and marks it stale. It recovers on
its own.

**The seed script fails on the first phase.** The migrations are not applied,
or `SUPABASE_SERVICE_ROLE_KEY` is the publishable key rather than the secret
one.
