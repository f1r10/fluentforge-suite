-- Private source-document upload foundation for document import.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'sources',
  'sources',
  false,
  1073741824
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit;

create table if not exists public.source_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  original_filename text not null,
  mime_type text,
  expected_size_bytes bigint not null check (expected_size_bytes > 0),
  keep_original boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  finalized_at timestamptz,
  source_file_id uuid references public.source_files(id) on delete set null
);

create index if not exists source_upload_sessions_expiry_idx
  on public.source_upload_sessions(expires_at)
  where finalized_at is null;

alter table public.source_upload_sessions enable row level security;

drop policy if exists "teacher full access" on public.source_upload_sessions;
create policy "teacher full access" on public.source_upload_sessions
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

grant select, insert, update, delete on public.source_upload_sessions to authenticated;
grant all on public.source_upload_sessions to service_role;

create index if not exists import_jobs_source_status_idx
  on public.import_jobs(source_file_id, status, created_at desc);

create index if not exists import_items_job_page_idx
  on public.import_items(job_id, page, created_at);

create index if not exists import_items_duplicate_idx
  on public.import_items(job_id, duplicate_kind)
  where duplicate_kind is not null;
