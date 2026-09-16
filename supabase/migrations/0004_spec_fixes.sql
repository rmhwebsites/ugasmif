-- ============================================================================
-- SMIF Hub — 0004_spec_fixes.sql
-- Corrections found auditing the build against SPEC.md.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. sector_targets: the strategy-team leader could never write a target.
--
-- SPEC Section 6 gives "Equity Strategies / Macro leader" the right to set
-- sector targets, and Section 9 writes that as "is_fund_officer(fund_id) or
-- leads_sector where sectors.is_strategy_team". The policy read that as "the
-- row's own sector must be the strategy team" — but target rows name ordinary
-- sectors (Technology, Healthcare, ...), never the strategy team itself, so
-- the branch was unreachable and every strategy-leader save failed on RLS.
-- The leadership test belongs to the FUND, not to the row being written.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function leads_strategy_team(p_fund uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from sectors s
    where s.fund_id = p_fund
      and s.is_strategy_team
      and s.is_active
      and leads_sector(s.id));
$$;

comment on function leads_strategy_team(uuid) is
  'True when the caller leads the fund''s strategy team (Equity Strategies / Macro).';

drop policy if exists sector_targets_insert on sector_targets;
create policy sector_targets_insert on sector_targets
  for insert to authenticated
  with check (is_fund_officer(fund_id) or leads_strategy_team(fund_id));

drop policy if exists sector_targets_update on sector_targets;
create policy sector_targets_update on sector_targets
  for update to authenticated
  using (is_fund_officer(fund_id) or leads_strategy_team(fund_id))
  with check (is_fund_officer(fund_id) or leads_strategy_team(fund_id));

drop policy if exists sector_targets_delete on sector_targets;
create policy sector_targets_delete on sector_targets
  for delete to authenticated
  using (is_fund_officer(fund_id) or leads_strategy_team(fund_id));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. academic_years: the PM must not start a new year.
--
-- SPEC Section 6 puts "Roster import, edit memberships, start new academic
-- year" with the officers and the app admin, and explicitly NOT with the PM.
-- is_any_fund_officer() includes portfolio_manager, so the rollover was open
-- to the one role the matrix excludes.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function is_any_roster_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_app_admin()
      or exists (
        select 1 from memberships m
        where m.user_id = auth.uid()
          and m.academic_year_id = current_year_id()
          and m.status = 'active'
          and m.role in ('president','vice_president','alumni_relations'));
$$;

comment on function is_any_roster_manager() is
  'Roster rights in any fund: president, VP, alumni relations, or app admin. The PM is excluded (SPEC Section 6).';

drop policy if exists academic_years_insert on academic_years;
create policy academic_years_insert on academic_years
  for insert to authenticated
  with check (is_any_roster_manager());

drop policy if exists academic_years_update on academic_years;
create policy academic_years_update on academic_years
  for update to authenticated
  using (is_any_roster_manager())
  with check (is_any_roster_manager());

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Pitches record the rule they were judged under.
--
-- SPEC Section 12: "Store both numbers on the pitch so history never depends
-- on current settings." Without this, changing the fund threshold silently
-- rewrites how every past vote reads.
-- ────────────────────────────────────────────────────────────────────────────

alter table pitches
  add column if not exists threshold_pct numeric(5,2),
  add column if not exists quorum_pct    numeric(5,2);

comment on column pitches.threshold_pct is
  'Pass threshold in force when this vote closed. Frozen so history does not move with fund settings.';
comment on column pitches.quorum_pct is
  'Quorum in force when this vote closed, or null when the fund had none.';

-- Backfill closed pitches from their fund's current settings: the best guess
-- available, and better than leaving history unlabelled.
update pitches p
set threshold_pct = f.vote_pass_threshold_pct,
    quorum_pct    = f.vote_quorum_pct
from funds f
where f.id = p.fund_id
  and p.threshold_pct is null
  and p.status in ('passed','failed','executed');

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Members can see how many ballots are in while a vote is open.
--
-- SPEC Section 12: "Members see the count of votes cast while open, not the
-- split." The votes table only exposes a member's own row, so a plain count
-- returns 1. This returns the total and nothing else — no split, no names.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function pitch_vote_count(p_pitch_id uuid)
returns integer
language plpgsql stable security definer set search_path = public
as $$
declare
  v_fund uuid;
  v_count integer;
begin
  select fund_id into v_fund from pitches where id = p_pitch_id;
  if v_fund is null or not has_fund_access(v_fund) then
    return null;
  end if;
  select count(*) into v_count from votes where pitch_id = p_pitch_id;
  return v_count;
end;
$$;

comment on function pitch_vote_count(uuid) is
  'Ballots cast on a pitch, for members of that fund. Count only — never the yes/no split or voter names.';

revoke all on function pitch_vote_count(uuid) from public, anon;
grant execute on function pitch_vote_count(uuid) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. close_pitch_vote freezes the rule it applied.
-- ────────────────────────────────────────────────────────────────────────────

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

  v_is_service := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
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
         -- Freeze the rule this vote was judged under, so changing fund
         -- settings later never rewrites how past results read (SPEC 12).
         threshold_pct   = f.vote_pass_threshold_pct,
         quorum_pct      = f.vote_quorum_pct,
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
    'eligible_voters', v_eligible, 'ticket_id', v_ticket_id,
    'threshold_pct', f.vote_pass_threshold_pct,
    'quorum_pct', f.vote_quorum_pct);
end;
$$;

notify pgrst, 'reload schema';
