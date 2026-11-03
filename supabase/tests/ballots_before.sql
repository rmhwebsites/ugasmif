-- ============================================================================
-- Ballot suite, part 1: the database as it stands before 0006.
--
-- run.sh applies the migrations up to 0005, runs this, then applies 0006 and
-- the rest and runs ballots.sql. That way the suite covers the real upgrade:
-- a vote that is already open, with plain yes/no ballots, when ballot
-- options arrive.
-- ============================================================================

\set ON_ERROR_STOP on

insert into academic_years (id, label, starts_on, ends_on, is_current)
values ('b1111111-0000-0000-0000-000000000001', '2026-27', '2026-08-01', '2027-07-31', true);

insert into funds (id, slug, name, asset_class, benchmark_symbol, benchmark_name,
                   vote_pass_threshold_pct, vote_quorum_pct, cash_balance) values
  ('b2222222-0000-0000-0000-000000000001', 'athena', 'Athena Stock Fund',
   'equity', 'SPY', 'S&P 500', 60.00, null, 100000.00),
  ('b2222222-0000-0000-0000-000000000002', 'arch', 'Arch Bond Fund',
   'fixed_income', 'AGG', 'Bloomberg US Aggregate', 60.00, null, 50000.00);

insert into sectors (id, fund_id, name, slug, sort_order) values
  ('b3333333-0000-0000-0000-000000000001',
   'b2222222-0000-0000-0000-000000000001', 'Technology', 'technology', 1),
  ('b3333333-0000-0000-0000-000000000002',
   'b2222222-0000-0000-0000-000000000002', 'Treasuries', 'treasuries', 1);

-- One officer, four analysts, an app admin, and an Arch analyst.
insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0000-0000-0000-000000000001', 'pm@uga.edu',        '{"full_name":"Athena PM"}'),
  ('b0000000-0000-0000-0000-00000000000a', 'a@uga.edu',         '{"full_name":"Analyst A"}'),
  ('b0000000-0000-0000-0000-00000000000b', 'b@uga.edu',         '{"full_name":"Analyst B"}'),
  ('b0000000-0000-0000-0000-00000000000c', 'c@uga.edu',         '{"full_name":"Analyst C"}'),
  ('b0000000-0000-0000-0000-00000000000d', 'd@uga.edu',         '{"full_name":"Analyst D"}'),
  ('b0000000-0000-0000-0000-0000000000ad', 'admin@uga.edu',     '{"full_name":"App Admin"}'),
  ('b0000000-0000-0000-0000-0000000000a2', 'arch.a@uga.edu',    '{"full_name":"Arch Analyst"}');

update profiles set is_app_admin = true where id = 'b0000000-0000-0000-0000-0000000000ad';

insert into memberships (user_id, fund_id, academic_year_id, role, sector_id) values
  ('b0000000-0000-0000-0000-000000000001', 'b2222222-0000-0000-0000-000000000001',
   'b1111111-0000-0000-0000-000000000001', 'portfolio_manager', null),
  ('b0000000-0000-0000-0000-00000000000a', 'b2222222-0000-0000-0000-000000000001',
   'b1111111-0000-0000-0000-000000000001', 'analyst', 'b3333333-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000b', 'b2222222-0000-0000-0000-000000000001',
   'b1111111-0000-0000-0000-000000000001', 'analyst', 'b3333333-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000c', 'b2222222-0000-0000-0000-000000000001',
   'b1111111-0000-0000-0000-000000000001', 'analyst', 'b3333333-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-00000000000d', 'b2222222-0000-0000-0000-000000000001',
   'b1111111-0000-0000-0000-000000000001', 'analyst', 'b3333333-0000-0000-0000-000000000001'),
  ('b0000000-0000-0000-0000-0000000000a2', 'b2222222-0000-0000-0000-000000000002',
   'b1111111-0000-0000-0000-000000000001', 'analyst', 'b3333333-0000-0000-0000-000000000002');

-- L (…01): a vote already open, with plain ballots (A yes, B no).
-- P, R, S (…02-04): submitted pitches the new ballot is tried on afterwards.
insert into pitches (id, fund_id, sector_id, author_id, title, pitch_type, action,
                     symbol, proposed_amount, status, vote_opens_at, vote_closes_at,
                     eligible_voters, threshold_pct, quorum_pct) values
  ('b4444444-0000-0000-0000-000000000001', 'b2222222-0000-0000-0000-000000000001',
   'b3333333-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'Legacy buy', 'single', 'buy', 'AAA', 40000, 'voting',
   now() - interval '1 hour', now() + interval '1 hour', 4, 60, null),
  ('b4444444-0000-0000-0000-000000000002', 'b2222222-0000-0000-0000-000000000001',
   'b3333333-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'Buy BBB', 'single', 'buy', 'BBB', 120000, 'submitted', null, null, null, null, null),
  ('b4444444-0000-0000-0000-000000000003', 'b2222222-0000-0000-0000-000000000001',
   'b3333333-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'Buy CCC', 'single', 'buy', 'CCC', 80000, 'submitted', null, null, null, null, null),
  ('b4444444-0000-0000-0000-000000000004', 'b2222222-0000-0000-0000-000000000001',
   'b3333333-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a',
   'Buy DDD', 'single', 'buy', 'DDD', null, 'submitted', null, null, null, null, null);

insert into votes (pitch_id, voter_id, choice) values
  ('b4444444-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000a', 'yes'),
  ('b4444444-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'no');
