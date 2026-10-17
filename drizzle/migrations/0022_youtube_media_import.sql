create table if not exists public.media_import_jobs (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('youtube')),
  source_url text not null,
  storage_path text not null unique,
  processor_job_id text,
  status text not null default 'queued'
    check (status in ('queued','processing','completed','failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  media_asset_id uuid references public.media_assets(id) on delete set null,
  rights_confirmed_at timestamptz not null,
  error text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists media_import_jobs_created_idx
  on public.media_import_jobs(created_at desc);

create index if not exists media_import_jobs_active_idx
  on public.media_import_jobs(status, created_at desc)
  where status in ('queued','processing');

alter table public.media_import_jobs enable row level security;

drop policy if exists "teacher full access" on public.media_import_jobs;
create policy "teacher full access" on public.media_import_jobs
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

grant select, insert, update, delete on public.media_import_jobs
  to authenticated;
grant all on public.media_import_jobs to service_role;
