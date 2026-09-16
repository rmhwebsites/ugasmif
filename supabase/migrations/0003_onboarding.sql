-- ============================================================================
-- SMIF Hub — 0003_onboarding.sql
-- First-run onboarding: the details the roster import cannot know.
--
-- Roster import creates accounts from email + full name. On first sign-in a
-- member confirms who they are and fills in the rest: given/family name,
-- phone, a photo, and the sector they sit in. onboarded_at gates the flow.
-- ============================================================================

alter table profiles
  add column if not exists first_name text,
  add column if not exists last_name  text,
  add column if not exists phone      text,
  add column if not exists onboarded_at timestamptz;

comment on column profiles.onboarded_at is
  'Set when the member completes first-run onboarding. Null sends them to /onboarding.';

-- Existing rows (the seed roster) have a full_name but no split name. Fill it
-- in so nobody is forced through onboarding just to restate what we know.
update profiles
set first_name = coalesce(first_name, nullif(split_part(full_name, ' ', 1), '')),
    last_name  = coalesce(
      last_name,
      nullif(substr(full_name, length(split_part(full_name, ' ', 1)) + 2), '')
    )
where first_name is null or last_name is null;

-- ────────────────────────────────────────────────────────────────────────────
-- Avatars bucket.
--
-- Public read: profile photos render in the sidebar, the roster, sector teams
-- and member pages, and signed URLs would expire mid-page. Paths are
-- {user_id}/{filename}, writes are restricted to the owner, and the app
-- itself is invite-only — but the images are reachable by URL, so treat this
-- as "shareable headshot", not private data. Flip `public` to false and move
-- rendering to signed URLs if that ever stops being acceptable.
-- ────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 2097152)  -- 2MB, enforced again in the route
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "avatars_read" on storage.objects;
create policy "avatars_read"
on storage.objects for select
using (bucket_id = 'avatars');

drop policy if exists "avatars_write_own" on storage.objects;
create policy "avatars_write_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(objects.name))[1] = auth.uid()::text
);

-- ────────────────────────────────────────────────────────────────────────────
-- Members pick their own sector during onboarding, but memberships are
-- otherwise officer-only (SPEC Section 6: the roster belongs to officers).
-- This lets a member set sector_id on their OWN active membership and nothing
-- else — the trigger rejects any other column change on that path.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists memberships_self_sector on memberships;
create policy memberships_self_sector
on memberships for update to authenticated
using (user_id = auth.uid() and status = 'active')
with check (user_id = auth.uid() and status = 'active');

create or replace function guard_self_membership_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Officers and the service role go through their own policies untouched.
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if is_roster_manager(new.fund_id) then
    return new;
  end if;
  if new.user_id <> auth.uid() then
    return new;  -- not the self-service path; other policies decide
  end if;
  if new.role              is distinct from old.role
  or new.fund_id           is distinct from old.fund_id
  or new.academic_year_id  is distinct from old.academic_year_id
  or new.is_sector_leader  is distinct from old.is_sector_leader
  or new.status            is distinct from old.status
  or new.title_override    is distinct from old.title_override
  or new.user_id           is distinct from old.user_id then
    raise exception 'memberships: you may only change your own sector';
  end if;
  -- The sector must belong to this membership's fund.
  if new.sector_id is not null and not exists (
    select 1 from sectors s
    where s.id = new.sector_id and s.fund_id = new.fund_id and s.is_active
  ) then
    raise exception 'memberships: that sector is not in this fund';
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_guard_self_update on memberships;
create trigger memberships_guard_self_update
  before update on memberships
  for each row execute function guard_self_membership_update();
