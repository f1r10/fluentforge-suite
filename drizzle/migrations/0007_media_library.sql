-- Private media library foundation.
-- Current development adapter uses Supabase Storage. The application-level
-- media_assets table remains portable and is the canonical media metadata.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'media',
  'media',
  false,
  734003200
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit;

create table if not exists public.media_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  kind public.media_kind not null,
  original_filename text not null,
  mime_type text,
  expected_size_bytes bigint not null check (expected_size_bytes >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  media_asset_id uuid references public.media_assets(id) on delete set null
);

create index if not exists media_upload_sessions_expiry_idx
  on public.media_upload_sessions(expires_at)
  where finalized_at is null;

create unique index if not exists media_assets_storage_path_uidx
  on public.media_assets(storage_path)
  where storage_path is not null and deleted_at is null;

alter table public.media_upload_sessions enable row level security;

create policy "teacher full access" on public.media_upload_sessions
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

grant select, insert, update, delete on public.media_upload_sessions to authenticated;
grant all on public.media_upload_sessions to service_role;

-- Browser uploads do not receive direct storage write privileges. Uploads use
-- short-lived signed upload tokens created by a privileged server function.
-- Downloads likewise use short-lived signed URLs from authorized app flows.
