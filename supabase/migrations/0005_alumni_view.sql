-- ────────────────────────────────────────────────────────────────────────────
-- settings.alumni_can_view_current (SPEC Section 11.3 / the year-rollover
-- rules): "Alumni keep login and can read everything their fund did while
-- they were in it plus the current dashboard (setting
-- settings.alumni_can_view_current, default true)."
--
-- The setting was on the admin form and in the API schema but nothing read
-- it, so turning it off changed nothing. It now cuts the fund's live position
-- data off at the end of the alumnus's last academic year: they keep the
-- record of what the fund did on their watch, and stop seeing what it holds
-- today.
--
-- Officers, the faculty advisor, app admins and anyone with a current-year
-- active membership are never restricted.
-- ────────────────────────────────────────────────────────────────────────────

-- The last date an alumnus may see, or null when they are not restricted.
-- Null is the common case, so every policy below reads "no horizon => no
-- change in behaviour".
create or replace function alumni_view_horizon(p_fund uuid)
returns date
language plpgsql stable security definer set search_path = public
as $$
declare
  m memberships;
  f funds;
  v_horizon date;
begin
  if is_app_admin() or is_faculty_advisor() then
    return null;
  end if;

  m := fund_membership(p_fund);
  if m.id is null then
    return null;  -- no membership at all; has_fund_access already says no
  end if;
  if m.status = 'active' and m.academic_year_id = current_year_id() then
    return null;  -- a current member
  end if;

  select * into f from funds where id = p_fund;
  if coalesce((f.settings ->> 'alumni_can_view_current')::boolean, true) then
    return null;  -- the fund lets alumni see current data (the default)
  end if;

  -- The end of the last academic year this person was active in. Fall back to
  -- today only if the roster has no year for them, which should not happen.
  select max(y.ends_on) into v_horizon
  from memberships mm
  join academic_years y on y.id = mm.academic_year_id
  where mm.user_id = auth.uid()
    and mm.fund_id = p_fund
    and mm.status in ('active', 'alumni');

  return coalesce(v_horizon, current_date);
end;
$$;

comment on function alumni_view_horizon(uuid) is
  'Last date a restricted alumnus may see in this fund, or null when unrestricted. Enforces settings.alumni_can_view_current.';

revoke all on function alumni_view_horizon(uuid) from public;
grant execute on function alumni_view_horizon(uuid) to authenticated, service_role;

-- ── Live position data: hidden outright, it has no historical slice ─────────

drop policy if exists holdings_select on holdings;
create policy holdings_select on holdings
  for select to authenticated
  using (has_fund_access(fund_id) and alumni_view_horizon(fund_id) is null);

drop policy if exists bond_marks_select on bond_marks;
create policy bond_marks_select on bond_marks
  for select to authenticated
  using (exists (
    select 1 from holdings h
    where h.id = bond_marks.holding_id
      and has_fund_access(h.fund_id)
      and alumni_view_horizon(h.fund_id) is null));

drop policy if exists trade_tickets_select on trade_tickets;
create policy trade_tickets_select on trade_tickets
  for select to authenticated
  using (has_fund_access(fund_id) and alumni_view_horizon(fund_id) is null);

-- ── Dated rows: visible up to the horizon ──────────────────────────────────

drop policy if exists fund_snapshots_select on fund_snapshots;
create policy fund_snapshots_select on fund_snapshots
  for select to authenticated
  using (
    has_fund_access(fund_id)
    and (alumni_view_horizon(fund_id) is null
         or snapshot_date <= alumni_view_horizon(fund_id)));

drop policy if exists cash_movements_select on cash_movements;
create policy cash_movements_select on cash_movements
  for select to authenticated
  using (
    has_fund_access(fund_id)
    and (alumni_view_horizon(fund_id) is null
         or occurred_on <= alumni_view_horizon(fund_id)));

drop policy if exists trades_select on trades;
create policy trades_select on trades
  for select to authenticated
  using (
    has_fund_access(fund_id)
    and (alumni_view_horizon(fund_id) is null
         or trade_date <= alumni_view_horizon(fund_id)));

-- pitches, votes, meetings, attendance, fund_updates and sector_targets are
-- deliberately left alone: they are the record of what the fund did, which
-- the spec says alumni keep either way.

notify pgrst, 'reload schema';
