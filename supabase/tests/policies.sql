-- ============================================================================
-- SMIF Hub — RLS and database-function test suite.
--
-- Run with:  ./supabase/tests/run.sh
--
-- Proves the Phase 0 acceptance criteria (SPEC Section 19) and the permission
-- matrix (SPEC Section 6) against a real PostgreSQL cluster:
--   * an analyst cannot insert a trades row
--   * a sector leader cannot submit another sector's pitch
--   * an Arch PM cannot execute in Athena
--   * a faculty advisor can execute in both funds
--   * nobody can grant themselves is_app_admin
--   * votes stay private to their voter until an officer looks
--
-- Every check prints an expectation next to its result. A raised ERROR where
-- the header says "expect ERROR" is a pass.
-- ============================================================================

\set ON_ERROR_STOP off
\pset pager off

-- ── Fixtures: both funds, sectors, and one member per role ──────────────────
insert into academic_years (id, label, starts_on, ends_on, is_current)
values ('11111111-1111-1111-1111-111111111111', '2026-27', '2026-08-01', '2027-07-31', true);

insert into funds (id, slug, name, asset_class, benchmark_symbol, benchmark_name,
                   vote_pass_threshold_pct, cash_balance) values
  ('22222222-2222-2222-2222-222222222222', 'athena', 'Athena Stock Fund',
   'equity', 'SPY', 'S&P 500', 60.00, 100000.00),
  ('22222222-2222-2222-2222-222222222223', 'arch', 'Arch Bond Fund',
   'fixed_income', 'AGG', 'Bloomberg US Aggregate', 60.00, 50000.00);

insert into sectors (id, fund_id, name, slug, sort_order) values
  ('33333333-3333-3333-3333-333333333333',
   '22222222-2222-2222-2222-222222222222', 'Technology', 'technology', 1),
  ('33333333-3333-3333-3333-333333333334',
   '22222222-2222-2222-2222-222222222222', 'Healthcare', 'healthcare', 2),
  ('33333333-3333-3333-3333-333333333335',
   '22222222-2222-2222-2222-222222222223', 'Treasuries', 'treasuries', 1);

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'athena.pm@uga.edu',   '{"full_name":"Athena PM"}'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'analyst@uga.edu',     '{"full_name":"Tech Analyst"}'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'techlead@uga.edu',    '{"full_name":"Tech Leader"}'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'president@uga.edu',   '{"full_name":"Athena President"}'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'arch.pm@uga.edu',     '{"full_name":"Arch PM"}'),
  ('aaaaaaaa-0000-0000-0000-000000000006', 'advisor@uga.edu',     '{"full_name":"Faculty Advisor"}'),
  ('aaaaaaaa-0000-0000-0000-000000000007', 'outsider@uga.edu',    '{"full_name":"Outsider"}');

insert into memberships (user_id, fund_id, academic_year_id, role, sector_id, is_sector_leader) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'portfolio_manager', null, false),
  ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'analyst', '33333333-3333-3333-3333-333333333333', false),
  ('aaaaaaaa-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'sector_leader', '33333333-3333-3333-3333-333333333333', true),
  ('aaaaaaaa-0000-0000-0000-000000000004', '22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 'president', null, false),
  ('aaaaaaaa-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222223',
   '11111111-1111-1111-1111-111111111111', 'portfolio_manager', null, false);

-- The advisor is a global flag, not a membership.
update profiles set is_faculty_advisor = true
where id = 'aaaaaaaa-0000-0000-0000-000000000006';

insert into holdings (id, fund_id, sector_id, instrument_type, symbol, name,
                      quantity, avg_cost, pricing_method)
values ('66666666-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',
        'equity', 'NVDA', 'NVIDIA', 100, 300, 'live');

\echo ''
\echo '############ PHASE 0 ACCEPTANCE CRITERIA (SPEC Section 19) ############'

-- ── 1. An analyst cannot insert a trades row ────────────────────────────────
set role authenticated;
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';

\echo ''
\echo '--- [1] analyst inserts a trade .......................... expect ERROR'
insert into trades (fund_id, holding_id, action, quantity, price, amount,
                    trade_date, executed_by)
values ('22222222-2222-2222-2222-222222222222',
        '66666666-0000-0000-0000-000000000001', 'buy', 1, 1, -1, current_date,
        'aaaaaaaa-0000-0000-0000-000000000002');

-- ── 2. A sector leader cannot submit another sector's pitch ─────────────────
reset role;
insert into pitches (id, fund_id, sector_id, author_id, title, pitch_type,
                     action, symbol, status)
values ('77777777-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333334',   -- Healthcare, not Technology
        'aaaaaaaa-0000-0000-0000-000000000002',
        'Buy LLY', 'bull', 'buy', 'LLY', 'draft');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';  -- Tech leader

\echo ''
\echo '--- [2] tech leader submits a healthcare pitch ........... expect 0 rows'
update pitches set status = 'submitted'
where id = '77777777-0000-0000-0000-000000000001'
returning id;

\echo ''
\echo '--- [2b] tech leader submits their OWN sector pitch ...... expect 1 row'
reset role;
insert into pitches (id, fund_id, sector_id, author_id, title, pitch_type,
                     action, symbol, status)
values ('77777777-0000-0000-0000-000000000002',
        '22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333',   -- Technology
        'aaaaaaaa-0000-0000-0000-000000000003',
        'Buy AMD', 'bull', 'buy', 'AMD', 'draft');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000003';
update pitches set status = 'submitted'
where id = '77777777-0000-0000-0000-000000000002'
returning id;

-- ── 3. An Arch PM cannot execute in Athena ──────────────────────────────────
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000005';  -- Arch PM

\echo ''
\echo '--- [3] Arch PM can_execute in Athena ......................... expect f'
select can_execute('22222222-2222-2222-2222-222222222222') as in_athena,
       can_execute('22222222-2222-2222-2222-222222222223') as in_arch;

\echo ''
\echo '--- [3b] Arch PM inserts an Athena holding ............... expect ERROR'
insert into holdings (fund_id, instrument_type, symbol, name, quantity,
                      avg_cost, pricing_method)
values ('22222222-2222-2222-2222-222222222222', 'equity', 'HACK', 'Wrong Fund',
        1, 1, 'live');

-- ── 4. A faculty advisor can execute in both funds ──────────────────────────
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000006';

\echo ''
\echo '--- [4] advisor can_execute in both ....................... expect t / t'
select can_execute('22222222-2222-2222-2222-222222222222') as in_athena,
       can_execute('22222222-2222-2222-2222-222222222223') as in_arch;

\echo ''
\echo '############ PERMISSION MATRIX (SPEC Section 6) ############'

-- ── Privilege escalation ────────────────────────────────────────────────────
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';

\echo ''
\echo '--- analyst grants themselves app admin .................. expect ERROR'
update profiles set is_app_admin = true
where id = 'aaaaaaaa-0000-0000-0000-000000000002';

\echo ''
\echo '--- analyst role after the attempt ..................... expect f/f/analyst'
select is_fund_officer('22222222-2222-2222-2222-222222222222') as is_officer,
       can_execute('22222222-2222-2222-2222-222222222222')     as can_execute,
       fund_role('22222222-2222-2222-2222-222222222222')       as role;

\echo ''
\echo '--- analyst edits fund settings ......................... expect 0 rows'
update funds set vote_pass_threshold_pct = 1
where id = '22222222-2222-2222-2222-222222222222' returning id;

\echo ''
\echo '--- analyst edits a membership .......................... expect 0 rows'
update memberships set role = 'president'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' returning id;

\echo ''
\echo '--- analyst reads the audit log ......................... expect 0 rows'
select count(*) as visible from audit_log;

-- ── The PM is excluded from roster management by the matrix ─────────────────
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';

\echo ''
\echo '--- Athena PM edits the roster .......................... expect 0 rows'
update memberships set role = 'viewer'
where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' returning id;

\echo ''
\echo '--- president edits the roster ........................... expect 1 row'
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000004';
update memberships set is_sector_leader = false
where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' returning id;

-- ── Outsider isolation ──────────────────────────────────────────────────────
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000007';

\echo ''
\echo '--- outsider reads everything ......................... expect all zero'
select (select count(*) from funds)    as funds,
       (select count(*) from holdings) as holdings,
       (select count(*) from trades)   as trades,
       (select count(*) from pitches)  as pitches,
       (select count(*) from votes)    as votes;

-- ── Vote privacy and eligibility ────────────────────────────────────────────
reset role;
update pitches
set status = 'voting',
    vote_opens_at = now() - interval '1 hour',
    vote_closes_at = now() + interval '1 hour'
where id = '77777777-0000-0000-0000-000000000002';

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';

\echo ''
\echo '--- analyst votes on an open pitch ....................... expect 1 row'
insert into votes (pitch_id, voter_id, choice)
values ('77777777-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000002', 'yes')
returning choice;

reset role;
insert into votes (pitch_id, voter_id, choice) values
  ('77777777-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000003', 'no'),
  ('77777777-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004', 'yes');
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000002';

\echo ''
\echo '--- analyst reads votes (own row only) ....................... expect 1'
select count(*) as visible_to_analyst from votes;

\echo ''
\echo '--- president reads votes (officer sees all) ................. expect 3'
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000004';
select count(*) as visible_to_officer from votes;

\echo ''
\echo '--- app admin casts a vote (admins are not students) ..... expect ERROR'
reset role;
update profiles set is_app_admin = true
where id = 'aaaaaaaa-0000-0000-0000-000000000007';
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000007';
insert into votes (pitch_id, voter_id, choice)
values ('77777777-0000-0000-0000-000000000002',
        'aaaaaaaa-0000-0000-0000-000000000007', 'yes');

\echo ''
\echo '--- apply_trade is not callable by the API roles .............. expect f'
reset role;
select has_function_privilege('authenticated', 'apply_trade(trades)', 'EXECUTE')
       as authenticated_can_call;

\echo ''
\echo '--- every public table has RLS enabled ................. expect 0 rows'
select t.tablename as table_without_rls
from pg_tables t
join pg_class c on c.relname = t.tablename
              and c.relnamespace = 'public'::regnamespace
where t.schemaname = 'public'
  and not c.relrowsecurity
  and t.tablename <> 'schema_migrations';
