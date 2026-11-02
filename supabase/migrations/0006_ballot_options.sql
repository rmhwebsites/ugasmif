-- 0006 — Ballot options: alternative allocations on a pitch vote.
--
-- A pitch vote used to be yes or no. In class the discussion often lands on
-- something in between ("yes, but half the size"), so a vote now carries a
-- list of options an officer can edit:
--
--   approve  one or more allocations, each with its own dollar amount
--            ("Yes, as pitched: $120,000", "Yes, at $60,000")
--   reject   exactly one "No"
--
-- and every voter may also abstain. A ballot still records yes / no / abstain
-- in votes.choice (so every existing count, report and RLS rule keeps
-- working) plus which option it was for in votes.option_id.
--
-- The rule (close_pitch_vote below):
--   * the pitch passes when all approve ballots together are at least the
--     threshold share of approve + reject ballots (an abstention counts for
--     neither side), and turnout, abstentions included, meets the quorum
--     when there is one
--   * the approve option with the most ballots is the allocation that
--     passed (ties go to the one listed first, the pitch as written), and its
--     amount goes on the trade ticket
--
-- Votes that closed before this migration have no options and keep their
-- plain yes/no result.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. The options
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists pitch_vote_options (
  id uuid primary key default gen_random_uuid(),
  pitch_id uuid not null references pitches(id) on delete cascade,
  kind text not null check (kind in ('approve','reject')),
  label text not null check (length(btrim(label)) between 1 and 200),
  -- The allocation in dollars for an approve option; null means "as pitched".
  amount numeric(15,2) check (amount is null or amount > 0),
  sort_order int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pitch_vote_options_pitch
  on pitch_vote_options (pitch_id, sort_order);

drop trigger if exists pitch_vote_options_set_updated_at on pitch_vote_options;
create trigger pitch_vote_options_set_updated_at
  before update on pitch_vote_options
  for each row execute function set_updated_at();

-- Options can change until the vote closes, so an officer can put the
-- allocations the class actually landed on to a vote. What a ballot meant
-- never changes under it, though:
--   * removing an option removes the ballots cast for it (the foreign key on
--     votes.option_id cascades), and those members are asked to vote again
--   * changing an option's amount does the same (clear_changed_option_ballots)
--   * an option never switches between approve and reject
--   * the "No" option stays for as long as the pitch does
-- Wording can always change. Once the vote closes nothing changes.
--
-- These rules are for people using the app. With no signed-in user (the
-- service role, or the SQL editor during a restore from backup or a one-off
-- fix) the trigger stands aside, since a restore has to load the options of
-- votes that closed long ago.
create or replace function guard_pitch_vote_option()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_pitch uuid := case when tg_op = 'DELETE' then old.pitch_id else new.pitch_id end;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from pitches where id = v_pitch;
  if not found then
    -- The pitch itself is being deleted and its options go with it.
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_status in ('passed','failed','executed','withdrawn') then
    raise exception 'The vote on this pitch is closed, so its options can no longer change';
  end if;
  if tg_op = 'DELETE' then
    if old.kind = 'reject' then
      raise exception 'Every ballot keeps a "No" option';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.pitch_id <> old.pitch_id then
      raise exception 'An option cannot move to another pitch';
    end if;
    if new.kind <> old.kind then
      raise exception 'An option cannot switch between yes and no';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pitch_vote_options_guard on pitch_vote_options;
create trigger pitch_vote_options_guard
  before insert or update or delete on pitch_vote_options
  for each row execute function guard_pitch_vote_option();

-- A ballot for "Yes, at $60,000" is not a ballot for $50,000. When the amount
-- changes, the ballots cast for the old amount are cleared and those members
-- vote again. Security definer because members' ballots are otherwise only
-- theirs to write.
create or replace function clear_changed_option_ballots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.amount is distinct from old.amount then
    delete from votes where option_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists pitch_vote_options_clear_ballots on pitch_vote_options;
create trigger pitch_vote_options_clear_ballots
  after update on pitch_vote_options
  for each row execute function clear_changed_option_ballots();

alter table pitch_vote_options enable row level security;

-- Anyone who can see the fund can see a pitch's ballot.
drop policy if exists pitch_vote_options_select on pitch_vote_options;
create policy pitch_vote_options_select on pitch_vote_options
  for select to authenticated
  using (exists (
    select 1 from pitches p
    where p.id = pitch_vote_options.pitch_id and has_fund_access(p.fund_id)));

-- Officers (and the app admin, whom is_fund_officer includes) set it up.
drop policy if exists pitch_vote_options_insert on pitch_vote_options;
create policy pitch_vote_options_insert on pitch_vote_options
  for insert to authenticated
  with check (exists (
    select 1 from pitches p
    where p.id = pitch_vote_options.pitch_id and is_fund_officer(p.fund_id)));

drop policy if exists pitch_vote_options_update on pitch_vote_options;
create policy pitch_vote_options_update on pitch_vote_options
  for update to authenticated
  using (exists (
    select 1 from pitches p
    where p.id = pitch_vote_options.pitch_id and is_fund_officer(p.fund_id)));

drop policy if exists pitch_vote_options_delete on pitch_vote_options;
create policy pitch_vote_options_delete on pitch_vote_options
  for delete to authenticated
  using (exists (
    select 1 from pitches p
    where p.id = pitch_vote_options.pitch_id and is_fund_officer(p.fund_id)));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Ballots name an option; abstaining is allowed
-- ────────────────────────────────────────────────────────────────────────────

alter table votes
  add column if not exists option_id uuid
    references pitch_vote_options(id) on delete cascade;

alter table votes drop constraint if exists votes_choice_check;
alter table votes
  add constraint votes_choice_check check (choice in ('yes','no','abstain'));

create index if not exists votes_option on votes (option_id);

-- A ballot's option has to belong to its pitch, and its yes/no has to match
-- the option's kind; an abstention names no option.
create or replace function check_vote_option()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  o pitch_vote_options;
begin
  if new.choice = 'abstain' then
    if new.option_id is not null then
      raise exception 'An abstention does not name an option';
    end if;
    return new;
  end if;
  if new.option_id is null then
    -- Only a pitch with no ballot options takes a bare yes or no.
    if exists (select 1 from pitch_vote_options where pitch_id = new.pitch_id) then
      raise exception 'Pick one of the options on the ballot';
    end if;
    return new;
  end if;
  select * into o from pitch_vote_options where id = new.option_id;
  if not found or o.pitch_id <> new.pitch_id then
    raise exception 'That option is not on this pitch''s ballot';
  end if;
  if (o.kind = 'approve' and new.choice <> 'yes') or (o.kind = 'reject' and new.choice <> 'no') then
    raise exception 'The ballot does not match the option it names';
  end if;
  return new;
end;
$$;

drop trigger if exists votes_check_option on votes;
create trigger votes_check_option
  before insert or update on votes
  for each row execute function check_vote_option();

-- Every ballot starts as "Yes, as pitched" (at the amount pitched) and "No".
-- Officers add the alternatives. Voting opens with these in place; a pitch
-- with none yet (one opened before this migration, or a ballot an officer is
-- about to edit) gets them on first use, and any bare yes/no ballots already
-- cast are pinned to them, since a yes before there were options was a yes
-- to the pitch as written.
--
-- Security definer so a member's first ballot on an older pitch can set the
-- defaults up. It only ever creates the two defaults, once, on a pitch whose
-- vote hasn't closed.
create or replace function ensure_ballot_options(p_pitch_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p pitches;
  v_yes uuid;
  v_no uuid;
begin
  select * into p from pitches where id = p_pitch_id for update;
  if not found or p.status in ('passed','failed','executed','withdrawn') then
    return;
  end if;
  -- auth.uid() is null for the scheduler (service role) and for this
  -- migration's own backfill below.
  if auth.uid() is not null and not has_fund_access(p.fund_id) then
    return;
  end if;
  if exists (select 1 from pitch_vote_options where pitch_id = p.id) then
    return;
  end if;

  insert into pitch_vote_options (pitch_id, kind, label, amount, sort_order, created_by)
  values (p.id, 'approve', 'Yes, as pitched',
          case when p.proposed_amount > 0 then p.proposed_amount end, 0, auth.uid())
  returning id into v_yes;
  insert into pitch_vote_options (pitch_id, kind, label, amount, sort_order, created_by)
  values (p.id, 'reject', 'No', null, 1, auth.uid())
  returning id into v_no;

  update votes
     set option_id = case when choice = 'yes' then v_yes else v_no end
   where pitch_id = p.id and option_id is null and choice in ('yes','no');
end;
$$;

revoke all on function ensure_ballot_options(uuid) from public, anon;
grant execute on function ensure_ballot_options(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Where the result lands on the pitch
-- ────────────────────────────────────────────────────────────────────────────

alter table pitches
  add column if not exists votes_abstain int not null default 0,
  add column if not exists winning_option_id uuid
    references pitch_vote_options(id) on delete set null;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. close_pitch_vote: abstentions, and the winning allocation
-- ────────────────────────────────────────────────────────────────────────────
-- Same as 0004's version except where marked NEW.

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
  abstain_ct int;                         -- NEW
  v_eligible int;
  v_pct numeric(6,2);
  v_status text;
  v_threshold numeric(5,2);
  v_quorum numeric(5,2);
  v_quorum_ok boolean := true;
  v_before jsonb;
  v_ticket_id uuid;
  v_winner pitch_vote_options;            -- NEW
begin
  select * into p from pitches where id = p_pitch_id for update;
  if not found then
    raise exception 'close_pitch_vote: pitch % not found', p_pitch_id;
  end if;

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
      'votes_abstain', p.votes_abstain,
      'winning_option_id', p.winning_option_id,
      'eligible_voters', p.eligible_voters, 'already_closed', true);
  end if;
  if p.status <> 'voting' then
    raise exception 'close_pitch_vote: pitch is %, only voting pitches can be closed', p.status;
  end if;

  select * into f from funds where id = p.fund_id;
  v_before := to_jsonb(p);

  select count(*) filter (where choice = 'yes'),
         count(*) filter (where choice = 'no'),
         count(*) filter (where choice = 'abstain')        -- NEW
    into yes_ct, no_ct, abstain_ct
    from votes where pitch_id = p_pitch_id;

  v_eligible := coalesce(p.eligible_voters, (
    select count(*) from memberships m
    where m.fund_id = p.fund_id
      and m.academic_year_id = current_year_id()
      and m.status = 'active'
      and m.role <> 'viewer'));

  if p.threshold_pct is not null then
    v_threshold := p.threshold_pct;
    v_quorum    := p.quorum_pct;
  else
    v_threshold := f.vote_pass_threshold_pct;
    v_quorum    := f.vote_quorum_pct;
  end if;

  if yes_ct + no_ct = 0 then
    v_pct := 0;
    v_status := 'failed';
  else
    v_pct := round(yes_ct::numeric / (yes_ct + no_ct) * 100, 2);
    if v_quorum is not null and v_eligible > 0 then
      -- NEW: an abstention is a ballot cast, so it counts toward turnout.
      v_quorum_ok := ((yes_ct + no_ct + abstain_ct)::numeric / v_eligible * 100) >= v_quorum;
    end if;
    v_status := case when v_pct >= v_threshold and v_quorum_ok
                     then 'passed' else 'failed' end;
  end if;

  -- NEW: the allocation that passed is the approve option with the most
  -- ballots; a tie goes to the one listed first, the pitch as written.
  if v_status = 'passed' then
    select o.* into v_winner
      from pitch_vote_options o
      left join votes v on v.option_id = o.id
     where o.pitch_id = p_pitch_id and o.kind = 'approve'
     group by o.id
     order by count(v.id) desc, o.sort_order asc, o.created_at asc
     limit 1;
  end if;

  update pitches
     set votes_yes         = yes_ct,
         votes_no          = no_ct,
         votes_abstain     = abstain_ct,              -- NEW
         winning_option_id = v_winner.id,             -- NEW (null on a fail)
         eligible_voters   = v_eligible,
         result_pct        = v_pct,
         status            = v_status,
         threshold_pct     = v_threshold,
         quorum_pct        = v_quorum,
         closed_by         = auth.uid(),
         closed_at         = now()
   where id = p_pitch_id
  returning * into p_after;

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
      -- NEW: the allocation the class chose, else the amount pitched.
      coalesce(v_winner.amount, p.proposed_amount))
    returning id into v_ticket_id;
  end if;

  perform log_audit(p.fund_id, 'pitch.close_vote', 'pitches', p.id::text,
                    v_before, to_jsonb(p_after));

  return jsonb_build_object(
    'status', v_status, 'result_pct', v_pct,
    'votes_yes', yes_ct, 'votes_no', no_ct,
    'votes_abstain', abstain_ct,
    'winning_option_id', v_winner.id,
    'eligible_voters', v_eligible, 'ticket_id', v_ticket_id,
    'threshold_pct', v_threshold,
    'quorum_pct', v_quorum);
end;
$$;

-- Votes open right now get their default options, with the ballots already
-- cast pinned to them.
do $$
declare
  r record;
begin
  for r in select id from pitches where status = 'voting' loop
    perform ensure_ballot_options(r.id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
