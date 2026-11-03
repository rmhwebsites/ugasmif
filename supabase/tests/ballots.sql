-- ============================================================================
-- Ballot suite, part 2: ballot options, abstentions and the winning
-- allocation (migration 0006). Runs after ballots_before.sql and the
-- migrations; see run.sh.
--
-- Unlike policies.sql this one checks itself: every check raises on a wrong
-- answer, so the suite either ends with "all ballot checks passed" or stops
-- at the first failure and names it.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off
-- Query results are empty; the NOTICEs and \echo lines are the report.
\o /dev/null

-- ── Helpers ─────────────────────────────────────────────────────────────────
create schema if not exists t;
grant usage on schema t to authenticated, service_role;

create or replace function t.eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;

-- Runs a statement that must fail with a message matching the pattern.
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

-- Rows a statement touched (an RLS-filtered update or delete touches none).
create or replace function t.touched(stmt text) returns int language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema t to authenticated, service_role;

-- Option ids by pitch and label, read as the superuser so RLS can't hide them.
create or replace function t.opt(p_pitch text, p_label text) returns uuid
language sql security definer as $$
  select id from pitch_vote_options
  where pitch_id = ('b4444444-0000-0000-0000-00000000000' || p_pitch)::uuid
    and label = p_label
$$;
grant execute on function t.opt(text, text) to authenticated;

\set athena '''b2222222-0000-0000-0000-000000000001'''
\set L '''b4444444-0000-0000-0000-000000000001'''
\set P '''b4444444-0000-0000-0000-000000000002'''
\set R '''b4444444-0000-0000-0000-000000000003'''
\set S '''b4444444-0000-0000-0000-000000000004'''

\echo '--- The open vote got default options, its ballots pinned to them'
select t.eq((select count(*) from pitch_vote_options where pitch_id = :L)::int, 2, 'L has two options');
select t.eq((select amount from pitch_vote_options where pitch_id = :L and kind = 'approve'),
            40000.00::numeric, 'L "Yes, as pitched" carries the pitched amount');
select t.eq((select o.kind from votes v join pitch_vote_options o on o.id = v.option_id
             where v.pitch_id = :L and v.voter_id = 'b0000000-0000-0000-0000-00000000000a'),
            'approve', 'A''s old yes now names the approve option');
select t.eq((select o.kind from votes v join pitch_vote_options o on o.id = v.option_id
             where v.pitch_id = :L and v.voter_id = 'b0000000-0000-0000-0000-00000000000b'),
            'reject', 'B''s old no now names No');
select t.eq((select count(*) from pitch_vote_options where pitch_id in (:P, :R, :S))::int, 0,
            'pitches not yet voting were left alone');

-- ── Who may set up a ballot ─────────────────────────────────────────────────
set role authenticated;

\echo '--- An Arch analyst cannot set up or see an Athena ballot'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000a2';
select ensure_ballot_options(:S);
reset role;
select t.eq((select count(*) from pitch_vote_options where pitch_id = :S)::int, 0,
            'ensure_ballot_options from another fund creates nothing');
set role authenticated;
select t.eq((select count(*) from pitch_vote_options where pitch_id = :L)::int, 0,
            'another fund''s options are invisible');

\echo '--- An Athena analyst reads options but cannot write them'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000a';
select t.eq((select count(*) from pitch_vote_options where pitch_id = :L)::int, 2,
            'a member sees their fund''s ballot');
select t.fails($$insert into pitch_vote_options (pitch_id, kind, label, amount)
                 values ('b4444444-0000-0000-0000-000000000001', 'approve', 'Mine', 1)$$,
               '%row-level security%', 'an analyst cannot add an option');
select t.eq(t.touched($$update pitch_vote_options set label = 'Hijacked'
                        where pitch_id = 'b4444444-0000-0000-0000-000000000001'$$), 0,
            'an analyst cannot reword an option');
select t.eq(t.touched($$delete from pitch_vote_options
                        where pitch_id = 'b4444444-0000-0000-0000-000000000001' and kind = 'approve'$$), 0,
            'an analyst cannot remove an option');

\echo '--- A member''s first touch on a pitch with no options sets up the defaults'
select ensure_ballot_options(:S);
select ensure_ballot_options(:S);
select t.eq((select count(*) from pitch_vote_options where pitch_id = :S)::int, 2,
            'defaults created once, not twice');
select t.eq((select amount from pitch_vote_options where pitch_id = :S and kind = 'approve'),
            null::numeric, 'no pitched amount: "as pitched" has none either');

\echo '--- The officer builds P''s ballot: as pitched, $60,000, No'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
select ensure_ballot_options(:P);
insert into pitch_vote_options (pitch_id, kind, label, amount, sort_order)
values (:P, 'approve', 'Yes, at $60,000', 60000, 1);
update pitch_vote_options set sort_order = 2 where pitch_id = :P and kind = 'reject';
select t.eq((select count(*) from pitch_vote_options where pitch_id = :P)::int, 3, 'P has three options');

\echo '--- The app admin is an officer for ballots too'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-0000000000ad';
select ensure_ballot_options(:R);
insert into pitch_vote_options (pitch_id, kind, label, amount, sort_order)
values (:R, 'approve', 'Yes, at $40,000', 40000, 1);
update pitch_vote_options set sort_order = 2 where pitch_id = :R and kind = 'reject';
select t.eq((select count(*) from pitch_vote_options where pitch_id = :R)::int, 3, 'R has three options');

-- ── Voting ──────────────────────────────────────────────────────────────────
reset role;
update pitches
   set status = 'voting', vote_opens_at = now() - interval '1 hour',
       vote_closes_at = now() + interval '1 hour', eligible_voters = 4,
       threshold_pct = 60, quorum_pct = 50
 where id in (:P, :R);
update pitches
   set status = 'voting', vote_opens_at = now() - interval '1 hour',
       vote_closes_at = now() + interval '1 hour', eligible_voters = 4,
       threshold_pct = 60, quorum_pct = 75
 where id = :S;
set role authenticated;

\echo '--- Ballots have to make sense'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000a';
select t.fails($$insert into votes (pitch_id, voter_id, choice) values
                 ('b4444444-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'yes')$$,
               '%Pick one of the options%', 'a bare yes on a pitch with options');
select t.fails(format($$insert into votes (pitch_id, voter_id, choice, option_id) values
                 ('b4444444-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'no', %L)$$,
                 t.opt('2', 'Yes, as pitched')),
               '%does not match%', 'a no that names an approve option');
select t.fails(format($$insert into votes (pitch_id, voter_id, choice, option_id) values
                 ('b4444444-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'abstain', %L)$$,
                 t.opt('2', 'No')),
               '%abstention does not name%', 'an abstention that names an option');
select t.fails(format($$insert into votes (pitch_id, voter_id, choice, option_id) values
                 ('b4444444-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-00000000000a', 'yes', %L)$$,
                 t.opt('1', 'Yes, as pitched')),
               '%not on this pitch%', 'an option from another pitch');

\echo '--- P: A as pitched, B $60,000, C no, D abstains'
insert into votes (pitch_id, voter_id, choice, option_id)
values (:P, 'b0000000-0000-0000-0000-00000000000a', 'yes', t.opt('2', 'Yes, as pitched'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
insert into votes (pitch_id, voter_id, choice, option_id)
values (:P, 'b0000000-0000-0000-0000-00000000000b', 'yes', t.opt('2', 'Yes, at $60,000'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000c';
insert into votes (pitch_id, voter_id, choice, option_id)
values (:P, 'b0000000-0000-0000-0000-00000000000c', 'no', t.opt('2', 'No'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000d';
insert into votes (pitch_id, voter_id, choice)
values (:P, 'b0000000-0000-0000-0000-00000000000d', 'abstain');

\echo '--- Editing options once people have voted'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
update pitch_vote_options set label = 'Yes, at $60k' where id = t.opt('2', 'Yes, at $60,000');
reset role;
select t.eq((select count(*) from votes where pitch_id = :P)::int, 4, 'rewording keeps every ballot');
set role authenticated;
update pitch_vote_options set amount = 50000, label = 'Yes, at $50,000' where id = t.opt('2', 'Yes, at $60k');
reset role;
select t.eq((select count(*) from votes where pitch_id = :P)::int, 3,
            'a new amount clears the ballots cast for the old one');
select t.eq((select count(*) from votes where pitch_id = :P
             and voter_id = 'b0000000-0000-0000-0000-00000000000b')::int, 0, 'B is asked again');
set role authenticated;
select t.fails(format($$update pitch_vote_options set kind = 'reject' where id = %L$$,
                      t.opt('2', 'Yes, as pitched')),
               '%cannot switch%', 'an option never flips between yes and no');
select t.fails(format($$delete from pitch_vote_options where id = %L$$, t.opt('2', 'No')),
               '%keeps a "No"%', 'No cannot be removed');
insert into pitch_vote_options (pitch_id, kind, label, amount, sort_order)
values (:P, 'approve', 'Yes, at $30,000', 30000, 3);

set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000d';
update votes set choice = 'yes', option_id = t.opt('2', 'Yes, at $30,000')
 where pitch_id = :P and voter_id = 'b0000000-0000-0000-0000-00000000000d';
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';
delete from pitch_vote_options where id = t.opt('2', 'Yes, at $30,000');
reset role;
select t.eq((select count(*) from votes where pitch_id = :P
             and voter_id = 'b0000000-0000-0000-0000-00000000000d')::int, 0,
            'removing an option removes the ballots cast for it');
set role authenticated;

\echo '--- P final: A as pitched, B and D $50,000, C no'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
insert into votes (pitch_id, voter_id, choice, option_id)
values (:P, 'b0000000-0000-0000-0000-00000000000b', 'yes', t.opt('2', 'Yes, at $50,000'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000d';
insert into votes (pitch_id, voter_id, choice, option_id)
values (:P, 'b0000000-0000-0000-0000-00000000000d', 'yes', t.opt('2', 'Yes, at $50,000'));

\echo '--- R: A as pitched, B $40,000, C no, D abstains (a tie between the yeses)'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000a';
insert into votes (pitch_id, voter_id, choice, option_id)
values (:R, 'b0000000-0000-0000-0000-00000000000a', 'yes', t.opt('3', 'Yes, as pitched'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
insert into votes (pitch_id, voter_id, choice, option_id)
values (:R, 'b0000000-0000-0000-0000-00000000000b', 'yes', t.opt('3', 'Yes, at $40,000'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000c';
insert into votes (pitch_id, voter_id, choice, option_id)
values (:R, 'b0000000-0000-0000-0000-00000000000c', 'no', t.opt('3', 'No'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000d';
insert into votes (pitch_id, voter_id, choice)
values (:R, 'b0000000-0000-0000-0000-00000000000d', 'abstain');

\echo '--- S (quorum 75%): A yes, B and D abstain'
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000a';
insert into votes (pitch_id, voter_id, choice, option_id)
values (:S, 'b0000000-0000-0000-0000-00000000000a', 'yes', t.opt('4', 'Yes, as pitched'));
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000b';
insert into votes (pitch_id, voter_id, choice) values (:S, 'b0000000-0000-0000-0000-00000000000b', 'abstain');
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-00000000000d';
insert into votes (pitch_id, voter_id, choice) values (:S, 'b0000000-0000-0000-0000-00000000000d', 'abstain');

-- ── Closing ─────────────────────────────────────────────────────────────────
set request.jwt.claim.sub = 'b0000000-0000-0000-0000-000000000001';

\echo '--- P passes 75%, and $50,000 is the allocation that passed'
select t.eq((close_pitch_vote(:P) ->> 'status'), 'passed', 'P passed');
reset role;
select t.eq((select result_pct from pitches where id = :P), 75.00::numeric, 'P result 75%');
select t.eq((select winning_option_id from pitches where id = :P), t.opt('2', 'Yes, at $50,000'),
            'P winner is the $50,000 option');
select t.eq((select est_amount from trade_tickets where pitch_id = :P), 50000.00::numeric,
            'P ticket is for $50,000, not the $120,000 pitched');
set role authenticated;

\echo '--- R passes 66.67%; a tie goes to the pitch as written'
select t.eq((close_pitch_vote(:R) ->> 'votes_abstain')::int, 1, 'R counts one abstention');
reset role;
select t.eq((select status from pitches where id = :R), 'passed', 'R passed (abstention not a no)');
select t.eq((select result_pct from pitches where id = :R), 66.67::numeric, 'R result 66.67%');
select t.eq((select winning_option_id from pitches where id = :R), t.opt('3', 'Yes, as pitched'),
            'R tie goes to "as pitched"');
select t.eq((select est_amount from trade_tickets where pitch_id = :R), 80000.00::numeric,
            'R ticket is the pitched $80,000');
set role authenticated;

\echo '--- S passes because abstentions count toward turnout (3 of 4 = 75%)'
select t.eq((close_pitch_vote(:S) ->> 'status'), 'passed', 'S passed on quorum with abstentions');
reset role;
select t.eq((select est_amount from trade_tickets where pitch_id = :S), null::numeric,
            'S ticket has no amount: none was pitched or voted');
set role authenticated;

\echo '--- L, the vote that was already open, closes the old way: 1 yes, 1 no'
select t.eq((close_pitch_vote(:L) ->> 'status'), 'failed', 'L failed at 50%');
reset role;
select t.eq((select winning_option_id from pitches where id = :L), null::uuid, 'a failed vote has no winner');
set role authenticated;

\echo '--- After close, the ballot is fixed'
select t.fails(format($$update pitch_vote_options set label = 'Changed' where id = %L$$,
                      t.opt('2', 'Yes, at $50,000')),
               '%closed%', 'no edits after close');
select t.fails($$insert into pitch_vote_options (pitch_id, kind, label, amount)
                 values ('b4444444-0000-0000-0000-000000000002', 'approve', 'Late', 1)$$,
               '%closed%', 'no new options after close');

\echo '--- A restore (nobody signed in) can still load a closed vote''s options'
reset role;
reset request.jwt.claim.sub;
insert into pitch_vote_options (pitch_id, kind, label, amount, sort_order)
values (:P, 'approve', 'Restored from backup', 1000, 9);
select t.eq((select count(*) from pitch_vote_options where pitch_id = :P
             and label = 'Restored from backup')::int, 1, 'restore path is not blocked');

\echo '--- Deleting a pitch still takes its options with it'
reset role;
delete from pitches where id = :L;
select t.eq((select count(*) from pitch_vote_options
             where pitch_id = 'b4444444-0000-0000-0000-000000000001')::int, 0,
            'options and No go with their pitch');

\echo ''
\echo '==> all ballot checks passed'
