-- ============================================================================
-- SMIF Hub — 0002_storage.sql
-- Storage buckets and object policies.
--
-- pitch-files: private. Path convention: {fund_slug}/{pitch_id}/{filename}
--   (first path segment = fund slug, second = pitch id). Decks are PDF/PPTX
--   up to 25MB, models are XLSX; the upload route validates types, the bucket
--   enforces the size cap. Downloads go out as signed URLs.
-- backups: private, service-role only (nightly JSON.gz exports, kept 90 days).
--
-- The service role bypasses RLS on storage.objects, so buckets with no
-- policies are service-role only.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('pitch-files', 'pitch-files', false, 26214400)  -- 25MB
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- pitch-files: read for members of the fund named by the first path segment.
-- ────────────────────────────────────────────────────────────────────────────

create policy "pitch_files_storage_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'pitch-files'
  and exists (
    select 1 from public.funds f
    -- objects.name must stay qualified: funds also has a "name" column and
    -- would capture the bare reference inside this subquery.
    where f.slug = (storage.foldername(objects.name))[1]
      and public.has_fund_access(f.id)
  )
);

-- ────────────────────────────────────────────────────────────────────────────
-- pitch-files: the pitch author, the leader of the pitch's sector, and fund
-- officers may upload and delete while the pitch is not closed (closed =
-- passed/failed/withdrawn/executed). The second path segment is the pitch id.
-- ────────────────────────────────────────────────────────────────────────────

create policy "pitch_files_storage_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pitch-files'
  and exists (
    select 1 from public.pitches p
    where p.id::text = (storage.foldername(objects.name))[2]
      and p.status in ('draft','submitted','scheduled','voting')
      and (
        p.author_id = auth.uid()
        or public.leads_sector(p.sector_id)
        or public.is_fund_officer(p.fund_id)
      )
  )
);

create policy "pitch_files_storage_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'pitch-files'
  and exists (
    select 1 from public.pitches p
    where p.id::text = (storage.foldername(objects.name))[2]
      and p.status in ('draft','submitted','scheduled','voting')
      and (
        p.author_id = auth.uid()
        or public.leads_sector(p.sector_id)
        or public.is_fund_officer(p.fund_id)
      )
  )
);

-- 'backups' intentionally has no storage.objects policies: only the service
-- role (backup lib/route, restore tooling) can read or write it.
