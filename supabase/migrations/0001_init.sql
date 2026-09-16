-- ============================================================================
-- SMIF Hub — 0001_init.sql
-- Full schema, triggers, business functions, RLS helpers and policies.
-- Spec: SPEC.md Sections 8 and 9. Mirrors src/lib/permissions.ts exactly.
-- PostgreSQL 15 / Supabase.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- Funds and years
-- ────────────────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────────────────
-- People
-- ────────────────────────────────────────────────────────────────────────────

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  is_app_admin boolean not null default false,
  is_faculty_advisor boolean not null default false,
  must_change_password boolean not null default false,
  avatar_url text,
  email_prefs jsonb not null default '{}'::jsonb,  -- { mute_updates?, mute_reminders? }
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

-- ────────────────────────────────────────────────────────────────────────────
-- Portfolio
-- ────────────────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────────────────
-- Pitch cycle
-- ────────────────────────────────────────────────────────────────────────────

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
  settings jsonb not null default '{}'::jsonb,  -- { paired_pitch_id? } bull/bear link
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

-- ────────────────────────────────────────────────────────────────────────────
-- Trading
-- ────────────────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────────────────
-- Class operations
-- ────────────────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────────────────
-- System
-- ────────────────────────────────────────────────────────────────────────────

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

-- ============================================================================
-- Triggers
-- ============================================================================

-- Keep updated_at current on every mutable table.
create or replace function set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger funds_set_updated_at         before update on funds         for each row execute function set_updated_at();
create trigger profiles_set_updated_at      before update on profiles      for each row execute function set_updated_at();
create trigger memberships_set_updated_at   before update on memberships   for each row execute function set_updated_at();
create trigger holdings_set_updated_at      before update on holdings      for each row execute function set_updated_at();
create trigger pitches_set_updated_at       before update on pitches       for each row execute function set_updated_at();
create trigger trade_tickets_set_updated_at before update on trade_tickets for each row execute function set_updated_at();

-- Create a profiles row for every new auth user. full_name falls back to the
-- email local part. BOOTSTRAP_ADMIN_EMAILS is applied by the seed script, not
-- here.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Global flags and the forced-password-change flag may only be changed by the
-- service role (admin routes). RLS cannot express per-column rules, so this
-- trigger enforces it.
-- Deliberately security INVOKER: the function only compares OLD and NEW, so
-- it needs no elevated rights, and running as the invoker is what makes
-- current_user the caller's actual role. Under security definer current_user
-- would be the function owner and the check below would pass for everyone.
create or replace function protect_profile_flags()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- PostgREST runs every API request as one of these two roles. Everything
  -- else is a trusted path: migrations and the seed script connect as
  -- postgres, and the admin routes use the service role, which PostgREST
  -- switches to service_role. Keying on the database role rather than a
  -- request.jwt.* setting means the guard holds no matter which claim form
  -- PostgREST populates.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.is_app_admin        is distinct from old.is_app_admin
  or new.is_faculty_advisor  is distinct from old.is_faculty_advisor
  or new.must_change_password is distinct from old.must_change_password then
    raise exception 'profiles: is_app_admin, is_faculty_advisor and must_change_password can only be changed via the service role';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_flags
  before update on profiles
  for each row execute function protect_profile_flags();

-- ============================================================================
-- RLS helper functions (Section 9). All security definer + stable +
-- search_path = public so they bypass RLS on the tables they consult and
-- cannot be hijacked via search_path. They mirror src/lib/permissions.ts.
-- ============================================================================

create or replace function is_app_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select p.is_app_admin from profiles p where p.id = auth.uid()),
    false);
$$;

create or replace function is_faculty_advisor()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select p.is_faculty_advisor from profiles p where p.id = auth.uid()),
    false);
$$;

create or replace function current_year_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from academic_years where is_current limit 1;
$$;

-- The caller's membership in p_fund: the current-year row when one exists,
-- otherwise the most recent past row (preferring alumni status).
create or replace function fund_membership(p_fund uuid)
returns memberships
language sql stable security definer set search_path = public
as $$
  select m.*
  from memberships m
  where m.user_id = auth.uid() and m.fund_id = p_fund
  order by (m.academic_year_id = current_year_id()) desc,
           (m.status = 'alumni') desc,
           m.created_at desc
  limit 1;
$$;

create or replace function has_fund_access(p_fund uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_app_admin()
      or is_faculty_advisor()
      or exists (
        select 1 from memberships m
        where m.user_id = auth.uid()
          and m.fund_id = p_fund
          and m.status in ('active','alumni'));
$$;

-- Effective role in p_fund. Alumni, inactive, and past-year memberships all
-- act as 'viewer' (permissions.ts effectiveRole). Null when no membership.
create or replace function fund_role(p_fund uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  m memberships;
begin
  m := fund_membership(p_fund);
  if m.id is null then
    return null;
  end if;
  if m.status = 'active' and m.academic_year_id = current_year_id() then
    return m.role;
  end if;
  return 'viewer';
end;
$$;

-- Officers: president, vice_president, portfolio_manager, alumni_relations
-- (active, current year), or app admin.
create or replace function is_fund_officer(p_fund uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_app_admin()
      or exists (
        select 1 from memberships m
        where m.user_id = auth.uid()
          and m.fund_id = p_fund
          and m.academic_year_id = current_year_id()
          and m.status = 'active'
          and m.role in ('president','vice_president','portfolio_manager','alumni_relations'));
$$;

-- Trade execution: active PM, faculty advisor, or app admin
-- (permissions.ts canExecute).
create or replace function can_execute(p_fund uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_app_admin()
      or is_faculty_advisor()
      or exists (
        select 1 from memberships m
        where m.user_id = auth.uid()
          and m.fund_id = p_fund
          and m.academic_year_id = current_year_id()
          and m.status = 'active'
          and m.role = 'portfolio_manager');
$$;

-- Roster management: president, vice_president, alumni_relations, or app
-- admin. The PM is an officer but is NOT a roster manager (spec matrix).
create or replace function is_roster_manager(p_fund uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_app_admin()
      or exists (
        select 1 from memberships m
        where m.user_id = auth.uid()
          and m.fund_id = p_fund
          and m.academic_year_id = current_year_id()
          and m.status = 'active'
          and m.role in ('president','vice_president','alumni_relations'));
$$;

create or replace function leads_sector(p_sector uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.sector_id = p_sector
      and m.academic_year_id = current_year_id()
      and m.status = 'active'
      and m.is_sector_leader);
$$;

create or replace function in_sector(p_sector uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid()
      and m.sector_id = p_sector
      and m.academic_year_id = current_year_id()
      and m.status = 'active');
$$;

-- The voting population: active current-year member with role != viewer, and
-- never an app admin (admins are not students — permissions.ts isActiveVoter).
create or replace function is_active_voter(p_fund uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select (not is_app_admin())
     and exists (
        select 1 from memberships m
        where m.user_id = auth.uid()
          and m.fund_id = p_fund
          and m.academic_year_id = current_year_id()
          and m.status = 'active'
          and m.role <> 'viewer');
$$;

-- Officer of at least one fund (or app admin). Used for cross-fund tables:
-- academic_years, roster_imports, backup_runs.
create or replace function is_any_fund_officer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_app_admin()
      or exists (
        select 1 from memberships m
        where m.user_id = auth.uid()
          and m.academic_year_id = current_year_id()
          and m.status = 'active'
          and m.role in ('president','vice_president','portfolio_manager','alumni_relations'));
$$;

-- Does the caller share at least one fund with p_user (any year)? Used by the
-- profiles select policy.
create or replace function shares_fund_with(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from memberships mine
    join memberships theirs on theirs.fund_id = mine.fund_id
    where mine.user_id = auth.uid()
      and theirs.user_id = p_user);
$$;

-- ============================================================================
-- Business functions
-- ============================================================================

-- Audit insert with the actor pinned to auth.uid(). The audit_log table has no
-- insert policy for authenticated users; this definer function (and the
-- service role) are the only write paths.
create or replace function log_audit(
  p_fund_id uuid,
  p_action text,
  p_entity text,
  p_entity_id text default null,
  p_before jsonb default null,
  p_after jsonb default null,
  p_ip text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into audit_log (actor_id, fund_id, action, entity, entity_id, before, after, ip)
  values (auth.uid(), p_fund_id, p_action, p_entity, p_entity_id, p_before, p_after, p_ip);
end;
$$;

-- Apply one immutable trades row to the fund state:
--  * buy: quantity up, weighted-average cost; reactivates a closed holding
--  * sell: quantity down, avg_cost unchanged; quantity 0 => is_active = false
--    and closed_on = trade_date
--  * cash_balance += amount + accrued_interest - commission
--    (amount and accrued are signed — negative on a buy; commission positive —
--    so a buy lowers cash by principal + accrued + commission and a sell
--    raises it by principal + accrued - commission).
-- Internal only: EXECUTE is revoked from anon/authenticated at the bottom of
-- this file. Call it through execute_ticket().
create or replace function apply_trade(t trades)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  h holdings;
  new_qty numeric;
begin
  select * into h from holdings where id = t.holding_id for update;
  if not found then
    raise exception 'apply_trade: holding % not found', t.holding_id;
  end if;

  if t.action = 'buy' then
    new_qty := h.quantity + t.quantity;
    update holdings
       set quantity  = new_qty,
           avg_cost  = case when new_qty = 0 then h.avg_cost
                            else ((h.quantity * h.avg_cost) + (t.quantity * t.price)) / new_qty end,
           is_active = true,
           closed_on = null,
           opened_on = coalesce(h.opened_on, t.trade_date)
     where id = h.id;
  else -- sell
    new_qty := h.quantity - t.quantity;
    if new_qty < 0 then
      raise exception 'apply_trade: sell quantity % exceeds position quantity %', t.quantity, h.quantity;
    end if;
    update holdings
       set quantity  = new_qty,
           is_active = (new_qty <> 0),
           closed_on = case when new_qty = 0 then t.trade_date else h.closed_on end
     where id = h.id;
  end if;

  update funds
     set cash_balance = cash_balance + t.amount + t.accrued_interest - t.commission
   where id = t.fund_id;
end;
$$;

-- Atomically execute a pending trade ticket:
--  1. re-check permission (can_execute) — this function is security definer,
--     so the check inside is mandatory, not decorative
--  2. create the holding when the ticket has none (new buy) with
--     pricing_method inferred from the instrument type
--  3. insert the signed trades ledger row (amount negative for a buy)
--  4. apply_trade() — holding upsert + cash adjustment
--  5. mark the ticket executed with the fill fields
--  6. flip a linked passed pitch to 'executed'
--  7. audit_log
-- Returns the new trades row id.
create or replace function execute_ticket(
  p_ticket_id uuid,
  p_fill_quantity numeric,
  p_fill_price numeric,
  p_accrued_interest numeric default 0,
  p_commission numeric default 0,
  p_trade_date date default current_date,
  p_settlement_date date default null,
  p_broker_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tk trade_tickets;
  tk_after trade_tickets;
  v_holding_id uuid;
  v_pricing text;
  v_gross numeric(15,2);       -- unsigned principal
  v_amount numeric(15,2);      -- signed principal
  v_accrued numeric(15,2);     -- signed like amount
  v_commission numeric(12,2);
  v_trade trades;
  v_before jsonb;
begin
  select * into tk from trade_tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'execute_ticket: ticket % not found', p_ticket_id;
  end if;

  if not can_execute(tk.fund_id) then
    raise exception 'execute_ticket: only the portfolio manager, faculty advisor, or an app admin can execute trades';
  end if;
  if tk.status <> 'pending' then
    raise exception 'execute_ticket: ticket is %, only pending tickets can be executed', tk.status;
  end if;
  if p_fill_quantity is null or p_fill_quantity <= 0 then
    raise exception 'execute_ticket: fill quantity must be positive';
  end if;
  if p_fill_price is null or p_fill_price < 0 then
    raise exception 'execute_ticket: fill price must be zero or positive';
  end if;
  if p_trade_date is null then
    raise exception 'execute_ticket: trade date is required';
  end if;

  v_before := to_jsonb(tk);

  -- Create the holding for a brand-new position.
  v_holding_id := tk.holding_id;
  if v_holding_id is null then
    if tk.action = 'sell' then
      raise exception 'execute_ticket: a sell ticket must reference an existing holding';
    end if;
    v_pricing := case
      when tk.instrument_type in ('equity','etf','money_market') then 'live'
      when tk.instrument_type = 'treasury' then 'treasury_curve'
      else 'manual'
    end;
    insert into holdings (fund_id, sector_id, instrument_type, symbol, cusip, name,
                          quantity, avg_cost, pricing_method, opened_on)
    values (tk.fund_id, tk.sector_id, tk.instrument_type, tk.symbol, tk.cusip, tk.name,
            0, 0, v_pricing, p_trade_date)
    returning id into v_holding_id;
  end if;

  -- Signed amounts. Bond prices are per 100 face; quantity is face value.
  v_gross := case
    when tk.instrument_type in ('treasury','corporate','agency_mbs','municipal')
      then round(p_fill_quantity * p_fill_price / 100.0, 2)
    else round(p_fill_quantity * p_fill_price, 2)
  end;
  v_amount     := case when tk.action = 'buy' then -v_gross else v_gross end;
  v_accrued    := case when tk.action = 'buy'
                       then -abs(coalesce(p_accrued_interest, 0))
                       else  abs(coalesce(p_accrued_interest, 0)) end;
  v_commission := abs(coalesce(p_commission, 0));

  -- Immutable ledger row.
  insert into trades (fund_id, ticket_id, holding_id, action, quantity, price,
                      amount, accrued_interest, commission, trade_date, executed_by, notes)
  values (tk.fund_id, tk.id, v_holding_id, tk.action, p_fill_quantity, p_fill_price,
          v_amount, v_accrued, v_commission, p_trade_date, auth.uid(), p_notes)
  returning * into v_trade;

  -- Holding + cash.
  perform apply_trade(v_trade);

  -- Ticket fill fields (accrued stored unsigned on the ticket).
  update trade_tickets
     set status           = 'executed',
         holding_id       = v_holding_id,
         executed_by      = auth.uid(),
         executed_at      = now(),
         fill_quantity    = p_fill_quantity,
         fill_price       = p_fill_price,
         fill_amount      = v_gross,
         accrued_interest = abs(v_accrued),
         commission       = v_commission,
         trade_date       = p_trade_date,
         settlement_date  = p_settlement_date,
         broker_reference = p_broker_reference,
         notes            = coalesce(p_notes, notes)
   where id = p_ticket_id
  returning * into tk_after;

  -- A passed pitch behind this ticket is now executed.
  if tk.pitch_id is not null then
    update pitches set status = 'executed'
     where id = tk.pitch_id and status = 'passed';
  end if;

  perform log_audit(tk.fund_id, 'trade.execute', 'trade_tickets', p_ticket_id::text,
                    v_before, to_jsonb(tk_after));

  return v_trade.id;
end;
$$;

-- Close voting on a pitch: tally, store the result, and on a pass (except
-- rebalances) create the pending trade ticket. Callable by fund officers/PM,
-- or by the daily cron through the service role. Security definer, so the
-- permission check inside is mandatory. Idempotent: closing an already-closed
-- pitch returns its stored result without changing anything.
create or replace function close_pitch_vote(p_pitch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p pitches;
  p_after pitches;
  f funds;
  h holdings;
  v_is_service boolean;
  yes_ct int;
  no_ct int;
  v_eligible int;
  v_pct numeric(6,2);
  v_status text;
  v_quorum_ok boolean := true;
  v_before jsonb;
  v_ticket_id uuid;
begin
  select * into p from pitches where id = p_pitch_id for update;
  if not found then
    raise exception 'close_pitch_vote: pitch % not found', p_pitch_id;
  end if;

  -- nullif: PostgREST leaves request.jwt.claims as the empty string on some
  -- paths, and ''::jsonb raises instead of returning null — which would turn
  -- a plain permission check into a confusing JSON syntax error.
  v_is_service := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    '') = 'service_role';
  if not (v_is_service or is_fund_officer(p.fund_id)) then
    raise exception 'close_pitch_vote: only fund officers or the scheduler can close a vote';
  end if;

  if p.status in ('passed','failed','executed','withdrawn') then
    return jsonb_build_object(
      'status', p.status, 'result_pct', p.result_pct,
      'votes_yes', p.votes_yes, 'votes_no', p.votes_no,
      'eligible_voters', p.eligible_voters, 'already_closed', true);
  end if;
  if p.status <> 'voting' then
    raise exception 'close_pitch_vote: pitch is %, only voting pitches can be closed', p.status;
  end if;

  select * into f from funds where id = p.fund_id;
  v_before := to_jsonb(p);

  select count(*) filter (where choice = 'yes'),
         count(*) filter (where choice = 'no')
    into yes_ct, no_ct
    from votes where pitch_id = p_pitch_id;

  -- Prefer the count captured when voting opened, so history never depends on
  -- later roster edits.
  v_eligible := coalesce(p.eligible_voters, (
    select count(*) from memberships m
    where m.fund_id = p.fund_id
      and m.academic_year_id = current_year_id()
      and m.status = 'active'
      and m.role <> 'viewer'));

  if yes_ct + no_ct = 0 then
    v_pct := 0;
    v_status := 'failed';
  else
    v_pct := round(yes_ct::numeric / (yes_ct + no_ct) * 100, 2);
    if f.vote_quorum_pct is not null and v_eligible > 0 then
      v_quorum_ok := ((yes_ct + no_ct)::numeric / v_eligible * 100) >= f.vote_quorum_pct;
    end if;
    v_status := case when v_pct >= f.vote_pass_threshold_pct and v_quorum_ok
                     then 'passed' else 'failed' end;
  end if;

  update pitches
     set votes_yes       = yes_ct,
         votes_no        = no_ct,
         eligible_voters = v_eligible,
         result_pct      = v_pct,
         status          = v_status,
         closed_by       = auth.uid(),
         closed_at       = now()
   where id = p_pitch_id
  returning * into p_after;

  -- A passed buy/add/trim/sell becomes a pending trade ticket. Rebalances are
  -- applied by an officer on the sectors admin page, never automatically.
  if v_status = 'passed' and p.action <> 'rebalance' then
    if p.holding_id is not null then
      select * into h from holdings where id = p.holding_id;
    end if;
    insert into trade_tickets (fund_id, pitch_id, holding_id, created_by, action,
                               instrument_type, symbol, cusip, name, sector_id,
                               est_price, est_amount)
    values (
      p.fund_id,
      p.id,
      p.holding_id,
      coalesce(auth.uid(), p.author_id),
      case when p.action in ('buy','add') then 'buy' else 'sell' end,
      coalesce(p.instrument_type, h.instrument_type, 'equity'),
      coalesce(p.symbol, h.symbol),
      h.cusip,
      coalesce(p.instrument_name, h.name, p.symbol, p.title),
      p.sector_id,
      p.target_price,
      p.proposed_amount)
    returning id into v_ticket_id;
  end if;

  perform log_audit(p.fund_id, 'pitch.close_vote', 'pitches', p.id::text,
                    v_before, to_jsonb(p_after));

  return jsonb_build_object(
    'status', v_status, 'result_pct', v_pct,
    'votes_yes', yes_ct, 'votes_no', no_ct,
    'eligible_voters', v_eligible, 'ticket_id', v_ticket_id);
end;
$$;

-- ============================================================================
-- Row Level Security (Section 9)
-- ============================================================================
-- The service role has BYPASSRLS, and the security definer functions above are
-- owned by the migration role (the table owner), so both write to any table
-- with no policy. "Service role only" below therefore means: no policy for
-- authenticated. anon gets no policies anywhere.

alter table funds              enable row level security;
alter table academic_years     enable row level security;
alter table profiles           enable row level security;
alter table sectors            enable row level security;
alter table memberships        enable row level security;
alter table holdings           enable row level security;
alter table price_snapshots    enable row level security;
alter table bond_marks         enable row level security;
alter table treasury_curve     enable row level security;
alter table fund_snapshots     enable row level security;
alter table sector_targets     enable row level security;
alter table pitches            enable row level security;
alter table pitch_files        enable row level security;
alter table votes              enable row level security;
alter table trade_tickets      enable row level security;
alter table trades             enable row level security;
alter table cash_movements     enable row level security;
alter table meetings           enable row level security;
alter table meeting_attendance enable row level security;
alter table fund_updates       enable row level security;
alter table update_reads       enable row level security;
alter table audit_log          enable row level security;
alter table roster_imports     enable row level security;
alter table backup_runs        enable row level security;

-- funds: read with access; only an app admin creates; officers edit settings;
-- never deleted.
create policy funds_select on funds
  for select to authenticated
  using (has_fund_access(id));
create policy funds_insert on funds
  for insert to authenticated
  with check (is_app_admin());
create policy funds_update on funds
  for update to authenticated
  using (is_fund_officer(id))
  with check (is_fund_officer(id));

-- academic_years: everyone signed in can read; officers of any fund (or admin)
-- manage; never deleted.
create policy academic_years_select on academic_years
  for select to authenticated
  using (true);
create policy academic_years_insert on academic_years
  for insert to authenticated
  with check (is_any_fund_officer());
create policy academic_years_update on academic_years
  for update to authenticated
  using (is_any_fund_officer())
  with check (is_any_fund_officer());

-- profiles: own row, fund-mates, advisor, admin. Inserts happen only through
-- the handle_new_user trigger (definer). Own updates allowed (name, avatar,
-- email_prefs); the protect_profile_flags trigger blocks flag changes outside
-- the service role. Never deleted (auth.users cascade handles removal).
create policy profiles_select on profiles
  for select to authenticated
  using (
    id = auth.uid()
    or is_app_admin()
    or is_faculty_advisor()
    or shares_fund_with(id)
  );
create policy profiles_update on profiles
  for update to authenticated
  using (id = auth.uid() or is_app_admin())
  with check (id = auth.uid() or is_app_admin());

-- sectors: readable with fund access; officers manage; delete only while
-- nothing references the sector.
create policy sectors_select on sectors
  for select to authenticated
  using (has_fund_access(fund_id));
create policy sectors_insert on sectors
  for insert to authenticated
  with check (is_fund_officer(fund_id));
create policy sectors_update on sectors
  for update to authenticated
  using (is_fund_officer(fund_id))
  with check (is_fund_officer(fund_id));
create policy sectors_delete on sectors
  for delete to authenticated
  using (
    is_fund_officer(fund_id)
    and not exists (select 1 from holdings h where h.sector_id = sectors.id)
    and not exists (select 1 from pitches p where p.sector_id = sectors.id)
  );

-- memberships: readable with fund access; roster writes are president /
-- vice_president / alumni_relations / app admin — the PM is excluded.
create policy memberships_select on memberships
  for select to authenticated
  using (has_fund_access(fund_id));
create policy memberships_insert on memberships
  for insert to authenticated
  with check (is_roster_manager(fund_id));
create policy memberships_update on memberships
  for update to authenticated
  using (is_roster_manager(fund_id))
  with check (is_roster_manager(fund_id));
create policy memberships_delete on memberships
  for delete to authenticated
  using (is_roster_manager(fund_id));

-- holdings: readable with fund access; PM/advisor/admin write; never deleted
-- (deactivate instead).
create policy holdings_select on holdings
  for select to authenticated
  using (has_fund_access(fund_id));
create policy holdings_insert on holdings
  for insert to authenticated
  with check (can_execute(fund_id));
create policy holdings_update on holdings
  for update to authenticated
  using (can_execute(fund_id))
  with check (can_execute(fund_id));

-- price_snapshots: read for all signed-in users; written by the cron via the
-- service role only.
create policy price_snapshots_select on price_snapshots
  for select to authenticated
  using (true);

-- bond_marks: access follows the holding's fund; PM/advisor/admin enter marks
-- as themselves; marks are immutable.
create policy bond_marks_select on bond_marks
  for select to authenticated
  using (exists (
    select 1 from holdings h
    where h.id = bond_marks.holding_id and has_fund_access(h.fund_id)));
create policy bond_marks_insert on bond_marks
  for insert to authenticated
  with check (
    marked_by = auth.uid()
    and exists (
      select 1 from holdings h
      where h.id = bond_marks.holding_id and can_execute(h.fund_id)));

-- treasury_curve: read for all signed-in users; written by the cron via the
-- service role only.
create policy treasury_curve_select on treasury_curve
  for select to authenticated
  using (true);

-- fund_snapshots: readable with fund access; inserted by the EOD cron
-- (service role) or by PM/advisor/admin (manual snapshot); immutable.
create policy fund_snapshots_select on fund_snapshots
  for select to authenticated
  using (has_fund_access(fund_id));
create policy fund_snapshots_insert on fund_snapshots
  for insert to authenticated
  with check (can_execute(fund_id));

-- sector_targets: readable with fund access; officers, or the leader of a
-- strategy team (Equity Strategies / Macro) for their own sector, manage.
create policy sector_targets_select on sector_targets
  for select to authenticated
  using (has_fund_access(fund_id));
create policy sector_targets_insert on sector_targets
  for insert to authenticated
  with check (
    is_fund_officer(fund_id)
    or exists (
      select 1 from sectors s
      where s.id = sector_targets.sector_id
        and s.is_strategy_team
        and leads_sector(s.id)));
create policy sector_targets_update on sector_targets
  for update to authenticated
  using (
    is_fund_officer(fund_id)
    or exists (
      select 1 from sectors s
      where s.id = sector_targets.sector_id
        and s.is_strategy_team
        and leads_sector(s.id)))
  with check (
    is_fund_officer(fund_id)
    or exists (
      select 1 from sectors s
      where s.id = sector_targets.sector_id
        and s.is_strategy_team
        and leads_sector(s.id)));
create policy sector_targets_delete on sector_targets
  for delete to authenticated
  using (
    is_fund_officer(fund_id)
    or exists (
      select 1 from sectors s
      where s.id = sector_targets.sector_id
        and s.is_strategy_team
        and leads_sector(s.id)));

-- pitches: readable with fund access. Drafted by sector members (officers:
-- any sector) as themselves, always starting in 'draft'. Updates: the author
-- while draft (may also withdraw), the sector leader through submitted,
-- officers for scheduling/opening/closing. Status changes at vote close and
-- execution go through the definer functions, which bypass these policies.
create policy pitches_select on pitches
  for select to authenticated
  using (has_fund_access(fund_id));
create policy pitches_insert on pitches
  for insert to authenticated
  with check (
    (in_sector(sector_id) or is_fund_officer(fund_id))
    and status = 'draft'
    and author_id = auth.uid());
create policy pitches_update on pitches
  for update to authenticated
  using (
    (author_id = auth.uid() and status = 'draft')
    or (leads_sector(sector_id) and status in ('draft','submitted'))
    or is_fund_officer(fund_id))
  with check (
    (author_id = auth.uid() and status in ('draft','withdrawn'))
    or (leads_sector(sector_id) and status in ('draft','submitted','withdrawn'))
    or is_fund_officer(fund_id));
create policy pitches_delete on pitches
  for delete to authenticated
  using (
    (author_id = auth.uid() and status = 'draft')
    or is_fund_officer(fund_id));

-- pitch_files: visible with access to the pitch; added/removed by the author,
-- the sector leader, or an officer while the pitch is not closed; rows are
-- never edited.
create policy pitch_files_select on pitch_files
  for select to authenticated
  using (exists (
    select 1 from pitches p
    where p.id = pitch_files.pitch_id and has_fund_access(p.fund_id)));
create policy pitch_files_insert on pitch_files
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from pitches p
      where p.id = pitch_files.pitch_id
        and p.status in ('draft','submitted','scheduled','voting')
        and (p.author_id = auth.uid()
             or leads_sector(p.sector_id)
             or is_fund_officer(p.fund_id))));
create policy pitch_files_delete on pitch_files
  for delete to authenticated
  using (exists (
    select 1 from pitches p
    where p.id = pitch_files.pitch_id
      and p.status in ('draft','submitted','scheduled','voting')
      and (p.author_id = auth.uid()
           or leads_sector(p.sector_id)
           or is_fund_officer(p.fund_id))));

-- votes: members see their own ballot; officers and the advisor see every
-- ballot. Casting requires an active non-viewer membership (app admins never
-- vote), an open voting window, and voting as yourself. A ballot can be
-- changed while the window is open; never deleted.
create policy votes_select on votes
  for select to authenticated
  using (
    voter_id = auth.uid()
    or is_faculty_advisor()
    or exists (
      select 1 from pitches p
      where p.id = votes.pitch_id and is_fund_officer(p.fund_id)));
create policy votes_insert on votes
  for insert to authenticated
  with check (
    voter_id = auth.uid()
    and exists (
      select 1 from pitches p
      where p.id = votes.pitch_id
        and p.status = 'voting'
        and now() between p.vote_opens_at and p.vote_closes_at
        and is_active_voter(p.fund_id)));
create policy votes_update on votes
  for update to authenticated
  using (
    voter_id = auth.uid()
    and exists (
      select 1 from pitches p
      where p.id = votes.pitch_id
        and p.status = 'voting'
        and now() between p.vote_opens_at and p.vote_closes_at))
  with check (
    voter_id = auth.uid()
    and exists (
      select 1 from pitches p
      where p.id = votes.pitch_id
        and p.status = 'voting'
        and now() between p.vote_opens_at and p.vote_closes_at));

-- trade_tickets: readable with fund access; created directly by PM/advisor/
-- admin (close_pitch_vote inserts through the definer path); updated (fill
-- prep, cancel) by the same; never deleted — cancel instead.
create policy trade_tickets_select on trade_tickets
  for select to authenticated
  using (has_fund_access(fund_id));
create policy trade_tickets_insert on trade_tickets
  for insert to authenticated
  with check (can_execute(fund_id) and created_by = auth.uid());
create policy trade_tickets_update on trade_tickets
  for update to authenticated
  using (can_execute(fund_id))
  with check (can_execute(fund_id));

-- trades: readable with fund access. No insert/update/delete policies on
-- purpose: the ledger is written only by execute_ticket() (security definer)
-- or the service role, and rows are immutable — corrections are reversal rows.
create policy trades_select on trades
  for select to authenticated
  using (has_fund_access(fund_id));

-- cash_movements: readable with fund access; recorded by PM/advisor/admin as
-- themselves; immutable.
create policy cash_movements_select on cash_movements
  for select to authenticated
  using (has_fund_access(fund_id));
create policy cash_movements_insert on cash_movements
  for insert to authenticated
  with check (can_execute(fund_id) and recorded_by = auth.uid());

-- meetings + attendance: readable with fund access; officers or the advisor
-- manage.
create policy meetings_select on meetings
  for select to authenticated
  using (has_fund_access(fund_id));
create policy meetings_insert on meetings
  for insert to authenticated
  with check (is_fund_officer(fund_id) or is_faculty_advisor());
create policy meetings_update on meetings
  for update to authenticated
  using (is_fund_officer(fund_id) or is_faculty_advisor())
  with check (is_fund_officer(fund_id) or is_faculty_advisor());
create policy meetings_delete on meetings
  for delete to authenticated
  using (is_fund_officer(fund_id) or is_faculty_advisor());

create policy meeting_attendance_select on meeting_attendance
  for select to authenticated
  using (exists (
    select 1 from meetings mt
    where mt.id = meeting_attendance.meeting_id and has_fund_access(mt.fund_id)));
create policy meeting_attendance_insert on meeting_attendance
  for insert to authenticated
  with check (exists (
    select 1 from meetings mt
    where mt.id = meeting_attendance.meeting_id
      and (is_fund_officer(mt.fund_id) or is_faculty_advisor())));
create policy meeting_attendance_update on meeting_attendance
  for update to authenticated
  using (exists (
    select 1 from meetings mt
    where mt.id = meeting_attendance.meeting_id
      and (is_fund_officer(mt.fund_id) or is_faculty_advisor())))
  with check (exists (
    select 1 from meetings mt
    where mt.id = meeting_attendance.meeting_id
      and (is_fund_officer(mt.fund_id) or is_faculty_advisor())));
create policy meeting_attendance_delete on meeting_attendance
  for delete to authenticated
  using (exists (
    select 1 from meetings mt
    where mt.id = meeting_attendance.meeting_id
      and (is_fund_officer(mt.fund_id) or is_faculty_advisor())));

-- fund_updates: readable with fund access; posted by officers or the advisor
-- as themselves; edited/removed by the author or an officer.
create policy fund_updates_select on fund_updates
  for select to authenticated
  using (has_fund_access(fund_id));
create policy fund_updates_insert on fund_updates
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and (is_fund_officer(fund_id) or is_faculty_advisor()));
create policy fund_updates_update on fund_updates
  for update to authenticated
  using (author_id = auth.uid() or is_fund_officer(fund_id))
  with check (author_id = auth.uid() or is_fund_officer(fund_id));
create policy fund_updates_delete on fund_updates
  for delete to authenticated
  using (author_id = auth.uid() or is_fund_officer(fund_id));

-- update_reads: strictly per-user read receipts.
create policy update_reads_select on update_reads
  for select to authenticated
  using (user_id = auth.uid());
create policy update_reads_insert on update_reads
  for insert to authenticated
  with check (user_id = auth.uid());
create policy update_reads_update on update_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy update_reads_delete on update_reads
  for delete to authenticated
  using (user_id = auth.uid());

-- audit_log: readable by officers of the row's fund, the advisor, and admins
-- (rows without a fund: advisor/admin only). Written only through log_audit()
-- or the service role; never edited.
create policy audit_log_select on audit_log
  for select to authenticated
  using (
    is_app_admin()
    or is_faculty_advisor()
    or (fund_id is not null and is_fund_officer(fund_id)));

-- roster_imports: readable by officers of any fund, the advisor, and admins;
-- written by the import route via the service role only.
create policy roster_imports_select on roster_imports
  for select to authenticated
  using (is_any_fund_officer() or is_faculty_advisor());

-- backup_runs: readable by officers of any fund, the advisor, and admins;
-- written by the backup job via the service role only.
create policy backup_runs_select on backup_runs
  for select to authenticated
  using (is_any_fund_officer() or is_faculty_advisor());

-- ============================================================================
-- PostgREST privileges (from GBH migration_repair_all.sql)
-- ============================================================================
-- PostgREST builds its schema cache from tables the API roles can access.
-- Without these grants a table is invisible to the API regardless of how
-- many times the cache is reloaded. RLS above still governs row access.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all routines in schema public to anon, authenticated, service_role;

-- Apply the same defaults to anything created later
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- apply_trade mutates holdings and cash with no internal permission check —
-- it is an internal helper for execute_ticket, never a client-callable RPC.
revoke execute on function apply_trade(trades) from public, anon, authenticated;
