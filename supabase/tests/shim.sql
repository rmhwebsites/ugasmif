-- Minimal stand-ins for the Supabase-managed schemas, so the migrations and
-- the policy suite can run against a plain PostgreSQL cluster. A real
-- Supabase project already has all of this; nothing here ships to production.

create extension if not exists pgcrypto;

create schema if not exists auth;
create schema if not exists storage;

do $$ begin create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
do $$ begin create role authenticator noinherit login password 'shim';
exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema auth, storage to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
grant select on auth.users to authenticated, service_role;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

-- GoTrue normally sets these claims per request; PostgREST exposes them as
-- GUCs. auth.uid() reads both the per-claim and the JSON-blob form, as the
-- real Supabase helper does.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

create or replace function auth.email() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'
  );
$$;

-- storage.foldername('a/b/c.pdf') -> {a,b}
create or replace function storage.foldername(name text) returns text[]
language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text) returns text
language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;
