-- 0007 — Alumni directory: LinkedIn links, and one read of everyone who has
-- been through SMIF.
--
-- The alumni page lists every former member of either fund with their
-- LinkedIn link, the years they were in the club, their role each year, and
-- the pitches they worked on. Anyone with access to either fund sees all of
-- it: an Arch analyst can look up an Athena alum. Row level security keeps
-- memberships, profiles and pitches inside each fund, so the page reads
-- through alumni_directory(), which returns those few fields and nothing
-- else (no email, no phone, no thesis).
--
-- Who counts as an alum: someone with a membership as a member (any role but
-- viewer, not marked inactive) in a past academic year, or marked alumni this
-- year, who has no active membership this year. The year rollover marks every
-- active member alumni and returning members get a new active row, so people
-- still in the club drop out of the list on their own.
--
-- "The pitches they worked on": every pitch their sector team took to a vote
-- while they were on it (the pitch's class date inside that academic year),
-- plus any pitch they wrote. Drafts, withdrawn pitches and ones never voted
-- on are left out.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. LinkedIn
-- ────────────────────────────────────────────────────────────────────────────

alter table profiles add column if not exists linkedin_url text;

alter table profiles drop constraint if exists profiles_linkedin_url_check;
alter table profiles add constraint profiles_linkedin_url_check check (
  linkedin_url is null
  or (length(linkedin_url) <= 300
      and linkedin_url ~* '^https://([a-z]{2,3}\.)?(www\.)?linkedin\.com/'));

comment on column profiles.linkedin_url is
  'Public LinkedIn profile URL, shown on the alumni page. Set by the member on their profile, or by a roster manager.';

-- Members set their own link on their profile (profiles_update already lets
-- them). Most alumni never log in again, so the people who manage a fund's
-- roster (president, vice president, director of alumni relations, app
-- admins) can set the link for anyone who has been on that fund, current or
-- past. Through this function rather than the service role, so the rule
-- lives here next to the column.
create or replace function set_member_linkedin(p_fund uuid, p_user uuid, p_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before text;
  v_after text := nullif(btrim(coalesce(p_url, '')), '');
begin
  if not is_roster_manager(p_fund) then
    raise exception 'Only the people who manage this fund''s roster can change a member''s LinkedIn link';
  end if;
  if not exists (select 1 from memberships m where m.user_id = p_user and m.fund_id = p_fund) then
    raise exception 'That person has never been on this fund''s roster';
  end if;
  select linkedin_url into v_before from profiles where id = p_user;
  update profiles set linkedin_url = v_after where id = p_user;
  perform log_audit(p_fund, 'profile.linkedin', 'profiles', p_user::text,
                    jsonb_build_object('linkedin_url', v_before),
                    jsonb_build_object('linkedin_url', v_after));
end;
$$;

revoke all on function set_member_linkedin(uuid, uuid, text) from public, anon;
grant execute on function set_member_linkedin(uuid, uuid, text) to authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. The directory
-- ────────────────────────────────────────────────────────────────────────────

create or replace function alumni_directory()
returns table (
  profile_id uuid,
  full_name text,
  avatar_url text,
  linkedin_url text,
  -- [{fund, fund_name, year, starts_on, role, title, leader, sector}], oldest first
  stints jsonb,
  -- [{id, fund, title, symbol, action, status, result_pct, date, sector, authored}], newest first
  pitches jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with viewer as (
    -- Members and alumni of either fund, the faculty advisor and app admins.
    select auth.uid() is not null
       and (is_app_admin()
            or is_faculty_advisor()
            or exists (select 1 from memberships m
                       where m.user_id = auth.uid()
                         and m.status in ('active', 'alumni'))) as allowed
  ),
  stint as (
    select m.user_id, m.fund_id, m.academic_year_id, m.status, m.role,
           m.title_override, m.is_sector_leader, m.sector_id,
           f.slug as fund_slug, f.name as fund_name,
           y.label as year_label, y.starts_on, y.ends_on,
           s.name as sector_name
      from memberships m
      join funds f on f.id = m.fund_id
      join academic_years y on y.id = m.academic_year_id
      left join sectors s on s.id = m.sector_id
     where m.status in ('active', 'alumni')
       and m.role <> 'viewer'
  ),
  alum as (
    select st.user_id from stint st
     where st.academic_year_id is distinct from current_year_id()
        or st.status = 'alumni'
    except
    select m.user_id from memberships m
     where m.academic_year_id = current_year_id()
       and m.status = 'active'
       and m.role <> 'viewer'
  ),
  voted as (
    -- Pitches that went to a vote, with the day they were presented.
    select p.*,
           coalesce(p.scheduled_for, p.vote_opens_at::date,
                    p.closed_at::date, p.created_at::date) as pitched_on
      from pitches p
     where p.status in ('voting', 'passed', 'failed', 'executed')
  ),
  worked_on as (
    select a.user_id, v.id as pitch_id, true as authored
      from alum a
      join voted v on v.author_id = a.user_id
    union all
    select st.user_id, v.id, false
      from stint st
      join alum a on a.user_id = st.user_id
      join voted v on v.fund_id = st.fund_id
                  and v.sector_id = st.sector_id
                  and v.pitched_on between st.starts_on and st.ends_on
     where st.sector_id is not null
  )
  select pr.id,
         pr.full_name,
         pr.avatar_url,
         pr.linkedin_url,
         (select jsonb_agg(jsonb_build_object(
                   'fund', st.fund_slug,
                   'fund_name', st.fund_name,
                   'year', st.year_label,
                   'starts_on', st.starts_on,
                   'role', st.role,
                   'title', st.title_override,
                   'leader', st.is_sector_leader,
                   'sector', st.sector_name)
                 order by st.starts_on, st.fund_slug)
            from stint st
           where st.user_id = pr.id),
         coalesce(
           (select jsonb_agg(jsonb_build_object(
                     'id', v.id,
                     'fund', f.slug,
                     'title', v.title,
                     'symbol', v.symbol,
                     'action', v.action,
                     'status', v.status,
                     'result_pct', v.result_pct,
                     'date', v.pitched_on,
                     'sector', s.name,
                     'authored', w.authored)
                   order by v.pitched_on desc, v.title)
              from (select wo.pitch_id, bool_or(wo.authored) as authored
                      from worked_on wo
                     where wo.user_id = pr.id
                     group by wo.pitch_id) w
              join voted v on v.id = w.pitch_id
              join funds f on f.id = v.fund_id
              left join sectors s on s.id = v.sector_id),
           '[]'::jsonb)
    from alum a
    join profiles pr on pr.id = a.user_id
   where (select allowed from viewer)
   order by pr.full_name;
$$;

comment on function alumni_directory() is
  'Former members of either fund, for the alumni page: name, picture, LinkedIn, roles by year, and the pitches they worked on. Readable by anyone with access to either fund.';

revoke all on function alumni_directory() from public, anon;
grant execute on function alumni_directory() to authenticated, service_role;

notify pgrst, 'reload schema';
