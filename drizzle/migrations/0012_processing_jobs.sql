create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  entity_type text,
  entity_id uuid,
  processor_job_id text not null unique,
  status public.job_status not null default 'queued',
  progress int not null default 0 check (progress between 0 and 100),
  params jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists processing_jobs_entity_idx
  on public.processing_jobs(entity_type, entity_id, created_at desc);

create index if not exists processing_jobs_status_idx
  on public.processing_jobs(status, updated_at);

alter table public.processing_jobs enable row level security;

drop policy if exists "teacher full access" on public.processing_jobs;
create policy "teacher full access" on public.processing_jobs
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

grant select, insert, update, delete on public.processing_jobs to authenticated;
grant all on public.processing_jobs to service_role;
