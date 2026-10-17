-- Application-level disaster-recovery backup metadata.
-- Authentication credentials and session secrets are intentionally outside
-- the backup package.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'backups',
  'backups',
  false,
  536870912
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit;

alter table public.backups
  add column if not exists mime_type text,
  add column if not exists checksum_sha256 text,
  add column if not exists manifest jsonb not null default '{}'::jsonb,
  add column if not exists completed_at timestamptz,
  add column if not exists last_restored_at timestamptz,
  add column if not exists restore_state jsonb not null default '{}'::jsonb;

create index if not exists backups_created_idx
  on public.backups(created_at desc);

grant select, insert, update, delete on public.backups to authenticated;
grant all on public.backups to service_role;
