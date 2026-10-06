-- Teacher export center.
-- Export files are private and accessed only through short-lived signed URLs.

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

create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (
    kind in (
      'questions',
      'vocabulary',
      'catalogs',
      'exams',
      'activity',
      'results',
      'students',
      'content_package'
    )
  ),
  format text not null check (format in ('json', 'xlsx', 'csv')),
  status text not null default 'processing' check (
    status in ('processing', 'completed', 'failed')
  ),
  storage_path text,
  mime_type text,
  size_bytes bigint,
  include_trash boolean not null default false,
  row_counts jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists export_jobs_created_idx
  on public.export_jobs(created_at desc);

create index if not exists export_jobs_expiry_idx
  on public.export_jobs(expires_at)
  where status = 'completed';

alter table public.export_jobs enable row level security;

drop policy if exists "teacher full access" on public.export_jobs;
create policy "teacher full access" on public.export_jobs
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

grant select, insert, update, delete on public.export_jobs to authenticated;
grant all on public.export_jobs to service_role;
