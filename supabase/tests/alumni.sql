-- ============================================================================
-- Alumni suite (migration 0007): who counts as an alum, which pitches they
-- get credit for, who can read the directory, and the LinkedIn column.
-- Runs on its own database after every migration; see run.sh. Checks
-- itself: it ends with "all alumni checks passed" or stops at the first
-- wrong answer.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off
\o /dev/null

create schema if not exists t;
grant usage on schema t to authenticated;
create or replace function t.eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;
create or replace function t.fails(stmt text, pattern text, label text)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike pattern then
      raise notice 'ok  %', label;
      return;
    end if;
    raise exception 'FAIL %: wrong error: %', label, sqlerrm;
  end;
  raise exception 'FAIL %: no error', label;
end $$;
grant execute on all functions in schema t to authenticated;

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- 2024-25 is past, 2025-26 is current.
insert into academic_years (id, label, starts_on, ends_on, is_current) values
  ('a1000000-0000-0000-0000-000000002425', '2024-25', '2024-08-01', '2025-07-31', false),
  ('a1000000-0000-0000-0000-000000002526', '2025-26', '2025-08-01', '2026-07-31', true);

insert into funds (id, slug, name, asset_class, benchmark_symbol, benchmark_name) values
  ('a2000000-0000-0000-0000-00000000000a', 'athena', 'Athena Stock Fund', 'equity', 'SPY', 'S&P 500'),
  ('a2000000-0000-0000-0000-00000000000b', 'arch', 'Arch Bond Fund', 'fixed_income', 'AGG', 'Bloomberg US Aggregate');

insert into sectors (id, fund_id, name, slug, sort_order) values
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', 'Technology', 'technology', 1),
  ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-00000000000a', 'Healthcare', 'healthcare', 2),
  ('a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-00000000000b', 'Treasuries', 'treasuries', 1);

-- A  Athena Tech analyst last year                        -> alum
-- B  Athena analyst last year, president this year        -> not an alum
-- C  Arch analyst last year                               -> alum
-- D  Athena viewer last year                              -> not an alum
-- E  Athena analyst last year, marked inactive            -> not an alum
-- F  Athena analyst this year only                        -> not an alum (reads the page)
-- G  no membership anywhere                               -> reads nothing
-- H  Athena PM last year, no sector                       -> alum
-- I  Arch analyst this year, marked alumni mid-year       -> alum
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0000-0000-0000-00000000000a', 'a@uga.edu', '{"full_name":"Alum A"}'),
  ('a0000000-0000-0000-0000-00000000000b', 'b@uga.edu', '{"full_name":"Back B"}'),
  ('a0000000-0000-0000-0000-00000000000c', 'c@uga.edu', '{"full_name":"Arch C"}'),
  ('a0000000-0000-0000-0000-00000000000d', 'd@uga.edu', '{"full_name":"Viewer D"}'),
  ('a0000000-0000-0000-0000-00000000000e', 'e@uga.edu', '{"full_name":"Inactive E"}'),
  ('a0000000-0000-0000-0000-00000000000f', 'f@uga.edu', '{"full_name":"Current F"}'),
  ('a0000000-0000-0000-0000-000000000009', 'g@uga.edu', '{"full_name":"Outsider G"}'),
  ('a0000000-0000-0000-0000-000000000008', 'h@uga.edu', '{"full_name":"PM H"}'),
  ('a0000000-0000-0000-0000-000000000007', 'i@uga.edu', '{"full_name":"Left I"}');

insert into memberships (user_id, fund_id, academic_year_id, role, sector_id, status, title_override) values
  ('a0000000-0000-0000-0000-00000000000a', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000002425', 'analyst', 'a3000000-0000-0000-0000-000000000001', 'alumni', null),
  ('a0000000-0000-0000-0000-00000000000b', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000002425', 'analyst', 'a3000000-0000-0000-0000-000000000001', 'alumni', null),
  ('a0000000-0000-0000-0000-00000000000b', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000002526', 'president', null, 'active', null),
  ('a0000000-0000-0000-0000-00000000000c', 'a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000002425', 'analyst', 'a3000000-0000-0000-0000-000000000003', 'alumni', null),
  ('a0000000-0000-0000-0000-00000000000d', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000002425', 'viewer', null, 'alumni', null),
  ('a0000000-0000-0000-0000-00000000000e', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000002425', 'analyst', 'a3000000-0000-0000-0000-000000000001', 'inactive', null),
  ('a0000000-0000-0000-0000-00000000000f', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000002526', 'analyst', 'a3000000-0000-0000-0000-000000000001', 'active', null),
  ('a0000000-0000-0000-0000-000000000008', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000002425', 'portfolio_manager', null, 'alumni', 'Co-PM'),
  ('a0000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000002526', 'analyst', 'a3000000-0000-0000-0000-000000000003', 'alumni', null);

-- Pitches. P1: Tech, last year, passed, written by A. P2: Tech, last year,
-- failed, written by B. P3: Tech, this year (after A left). P4: Healthcare,
-- last year, written by H. P5: Tech, last year, still a draft. P6: Tech,
-- last year, withdrawn.
insert into pitches (id, fund_id, sector_id, author_id, title, pitch_type, action, symbol,
                     status, scheduled_for, result_pct) values
  ('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000a', 'Buy AAA', 'single', 'buy', 'AAA', 'passed', '2025-02-10', 78.00),
  ('a4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000b', 'Buy BBB', 'single', 'buy', 'BBB', 'failed', '2024-10-01', 30.00),
  ('a4000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000f', 'Buy CCC', 'single', 'buy', 'CCC', 'passed', '2025-10-01', 70.00),
  ('a4000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000008', 'Buy DDD', 'single', 'buy', 'DDD', 'executed', '2025-03-01', 90.00),
  ('a4000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000a', 'Buy EEE', 'single', 'buy', 'EEE', 'draft', '2025-03-01', null),
  ('a4000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-00000000000a', 'a3000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-00000000000a', 'Buy FFF', 'single', 'buy', 'FFF', 'withdrawn', '2025-03-01', null);

-- ── Who can read it ─────────────────────────────────────────────────────────
set role authenticated;

\echo '--- Someone with no membership reads nothing'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-000000000009';
select t.eq((select count(*) from alumni_directory())::int, 0, 'outsider gets no rows');

\echo '--- A current Athena analyst sees the alumni of both funds'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000f';
select t.eq((select string_agg(full_name, ', ' order by full_name) from alumni_directory()),
            'Alum A, Arch C, Left I, PM H', 'the four alumni, Arch included');

\echo '--- An alum reads it too'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000c';
select t.eq((select count(*) from alumni_directory())::int, 4, 'an alum sees the list');

-- ── What it says ───────────────────────────────────────────────────────────
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000f';

\echo '--- A: the Tech pitches from her year, once each, and not the rest'
select t.eq((select string_agg(p ->> 'title', ', ' order by p ->> 'title')
               from alumni_directory() d, jsonb_array_elements(d.pitches) p
              where d.full_name = 'Alum A'),
            'Buy AAA, Buy BBB', 'Tech pitches voted on while she was on Tech');
select t.eq((select (p ->> 'authored')::boolean
               from alumni_directory() d, jsonb_array_elements(d.pitches) p
              where d.full_name = 'Alum A' and p ->> 'title' = 'Buy AAA'),
            true, 'the one she wrote says so');
select t.eq((select (p ->> 'authored')::boolean
               from alumni_directory() d, jsonb_array_elements(d.pitches) p
              where d.full_name = 'Alum A' and p ->> 'title' = 'Buy BBB'),
            false, 'a teammate''s pitch does not');
select t.eq((select d.pitches -> 0 ->> 'title' from alumni_directory() d where d.full_name = 'Alum A'),
            'Buy AAA', 'newest pitch first');

\echo '--- H: an officer with no sector gets the pitch he wrote'
select t.eq((select string_agg(p ->> 'title', ', ')
               from alumni_directory() d, jsonb_array_elements(d.pitches) p
              where d.full_name = 'PM H'),
            'Buy DDD', 'authored pitch outside any sector stint');
select t.eq((select d.stints -> 0 ->> 'title' from alumni_directory() d where d.full_name = 'PM H'),
            'Co-PM', 'title override carried');

\echo '--- Stints carry fund, year, role and sector'
select t.eq((select d.stints -> 0 ->> 'year' || ' ' || (d.stints -> 0 ->> 'fund') || ' '
                    || (d.stints -> 0 ->> 'role') || ' ' || (d.stints -> 0 ->> 'sector')
               from alumni_directory() d where d.full_name = 'Arch C'),
            '2024-25 arch analyst Treasuries', 'Arch C stint');
select t.eq((select jsonb_array_length(d.pitches) from alumni_directory() d where d.full_name = 'Left I'),
            0, 'no pitches is an empty list, not null');

-- ── LinkedIn ───────────────────────────────────────────────────────────────
\echo '--- Members set their own LinkedIn; it has to be a LinkedIn https link'
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000a';
update profiles set linkedin_url = 'https://www.linkedin.com/in/alum-a'
 where id = 'a0000000-0000-0000-0000-00000000000a';
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000f';
select t.eq((select linkedin_url from alumni_directory() where full_name = 'Alum A'),
            'https://www.linkedin.com/in/alum-a', 'link shows in the directory');
reset role;
select t.fails($$update profiles set linkedin_url = 'https://evil.example/linkedin.com/in/x'
                 where id = 'a0000000-0000-0000-0000-00000000000a'$$,
               '%profiles_linkedin_url_check%', 'a non-LinkedIn host is refused');
select t.fails($$update profiles set linkedin_url = 'javascript:alert(1)//linkedin.com/'
                 where id = 'a0000000-0000-0000-0000-00000000000a'$$,
               '%profiles_linkedin_url_check%', 'a script link is refused');
update profiles set linkedin_url = 'https://uk.linkedin.com/in/someone'
 where id = 'a0000000-0000-0000-0000-00000000000c';
select t.eq((select linkedin_url from profiles where id = 'a0000000-0000-0000-0000-00000000000c'),
            'https://uk.linkedin.com/in/someone', 'country subdomains are fine');

\echo '--- Roster managers set the link for alumni; nobody else can'
set role authenticated;
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000b';  -- Athena president
select set_member_linkedin('a2000000-0000-0000-0000-00000000000a',
                           'a0000000-0000-0000-0000-000000000008',
                           'https://www.linkedin.com/in/pm-h');
select t.eq((select linkedin_url from alumni_directory() where full_name = 'PM H'),
            'https://www.linkedin.com/in/pm-h', 'the president set an alum''s link');
select set_member_linkedin('a2000000-0000-0000-0000-00000000000a',
                           'a0000000-0000-0000-0000-000000000008', '  ');
select t.eq((select linkedin_url from alumni_directory() where full_name = 'PM H'),
            null::text, 'blank clears it');
select t.fails($$select set_member_linkedin('a2000000-0000-0000-0000-00000000000a',
                   'a0000000-0000-0000-0000-00000000000c', 'https://www.linkedin.com/in/c')$$,
               '%never been on this fund%', 'not for someone from the other fund');
select t.fails($$select set_member_linkedin('a2000000-0000-0000-0000-00000000000a',
                   'a0000000-0000-0000-0000-000000000008', 'https://evil.example/')$$,
               '%profiles_linkedin_url_check%', 'the link check still applies');
set request.jwt.claim.sub = 'a0000000-0000-0000-0000-00000000000f';  -- an analyst
select t.fails($$select set_member_linkedin('a2000000-0000-0000-0000-00000000000a',
                   'a0000000-0000-0000-0000-000000000008', 'https://www.linkedin.com/in/x')$$,
               '%manage this fund%', 'an analyst cannot');
reset role;
select t.eq((select count(*) from audit_log where action = 'profile.linkedin')::int, 2,
            'each change is in the audit log');

\echo ''
\echo '==> all alumni checks passed'
