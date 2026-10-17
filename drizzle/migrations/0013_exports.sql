-- Teacher export center.
-- export_jobs already exists in the base schema; extend it without replacing
-- existing history. Export files are private and served through signed URLs.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'exports',
  'exports',
  false,
  1073741824
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit;

alter table public.export_jobs
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint,
  add column if not exists include_trash boolean not null default false,
  add column if not exists row_counts jsonb not null default '{}'::jsonb,
  add column if not exists completed_at timestamptz,
  add column if not exists expires_at timestamptz not null
    default (now() + interval '24 hours');

create index if not exists export_jobs_created_idx
  on public.export_jobs(created_at desc);

create index if not exists export_jobs_expiry_idx
  on public.export_jobs(expires_at)
  where status = 'completed';

-- The base migration already enables RLS and grants teacher-only access.
-- Reassert grants for upgraded databases.
grant select, insert, update, delete on public.export_jobs to authenticated;
grant all on public.export_jobs to service_role;
