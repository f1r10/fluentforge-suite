-- Restore append-only event batches atomically and idempotently.
-- An interrupted retry must never insert duplicate activity/audit rows.
create table if not exists public.backup_event_restore_batches (
  backup_id uuid not null references public.backups(id) on delete cascade,
  event_table text not null check (event_table in ('activity_events', 'audit_logs')),
  batch_index integer not null check (batch_index >= 0),
  row_count integer not null check (row_count between 0 and 250),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{32},
  completed_at timestamptz not null default now(),
  primary key (backup_id, event_table, batch_index)
);
revoke all on public.backup_event_restore_batches from public, anon, authenticated;
grant select, insert on public.backup_event_restore_batches to service_role;
alter table public.backup_event_restore_batches enable row level security;

create or replace function public.restore_event_batch(
  p_backup_id uuid, p_table text, p_index integer, p_rows jsonb
) returns integer language plpgsql security definer
set search_path = public as $$
declare
  previous public.backup_event_restore_batches%rowtype;
  inserted integer;
  expected_sha text;
begin
  if p_backup_id is null or p_table not in ('activity_events','audit_logs')
     or p_index is null or p_index < 0 or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 250
     then
    raise exception 'Invalid append-only restore batch';
  end if;
  if not exists (select 1 from public.backups where id = p_backup_id) then
    raise exception 'Unknown backup restore job';
  end if;

  expected_sha := md5(p_rows::text);

  -- Prevent concurrent replays of the same batch; the ledger and event rows
  -- commit in the SAME database transaction.
  perform pg_advisory_xact_lock(hashtextextended(p_backup_id::text || ':' || p_table || ':' || p_index::text, 0));
  select * into previous from public.backup_event_restore_batches
    where backup_id=p_backup_id and event_table=p_table and batch_index=p_index;
  if found then
    if previous.content_sha256 <> expected_sha or previous.row_count <> jsonb_array_length(p_rows) then
      raise exception 'Conflicting event batch replay refused';
    end if;
    return 0;
  end if;

  if p_table = 'activity_events' then
    insert into public.activity_events
      (student_id, category, event_type, entity_type, entity_id, attempt_id,
       is_correct, response, duration_ms, details, created_at)
    select student_id, category, event_type, entity_type, entity_id, attempt_id,
           is_correct, response, duration_ms, details, created_at
      from jsonb_populate_recordset(null::public.activity_events, p_rows);
  else
    insert into public.audit_logs
      (actor_type, actor_id, action, entity_type, entity_id, summary, details, ip, created_at)
    select actor_type, actor_id, action, entity_type, entity_id, summary, details, ip, created_at
      from jsonb_populate_recordset(null::public.audit_logs, p_rows);
  end if;

  inserted := jsonb_array_length(p_rows);
  insert into public.backup_event_restore_batches
    (backup_id,event_table,batch_index,row_count,content_sha256)
    values (p_backup_id,p_table,p_index,inserted,expected_sha);
  return inserted;
end $$;
revoke all on function public.restore_event_batch(uuid,text,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.restore_event_batch(uuid,text,integer,jsonb) to service_role;
notify pgrst, 'reload schema';
),
  completed_at timestamptz not null default now(),
  primary key (backup_id, event_table, batch_index)
);
revoke all on public.backup_event_restore_batches from public, anon, authenticated;
grant select, insert on public.backup_event_restore_batches to service_role;
alter table public.backup_event_restore_batches enable row level security;

create or replace function public.restore_event_batch(
  p_backup_id uuid, p_table text, p_index integer, p_rows jsonb
) returns integer language plpgsql security definer
set search_path = public as $$
declare
  previous public.backup_event_restore_batches%rowtype;
  inserted integer;
  expected_sha text;
begin
  if p_backup_id is null or p_table not in ('activity_events','audit_logs')
     or p_index is null or p_index < 0 or p_rows is null
     or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 250
     then
    raise exception 'Invalid append-only restore batch';
  end if;
  if not exists (select 1 from public.backups where id = p_backup_id) then
    raise exception 'Unknown backup restore job';
  end if;

  expected_sha := encode(extensions.digest(convert_to(p_rows::text, 'UTF8'), 'sha256'), 'hex');

  -- Prevent concurrent replays of the same batch; the ledger and event rows
  -- commit in the SAME database transaction.
  perform pg_advisory_xact_lock(hashtextextended(p_backup_id::text || ':' || p_table || ':' || p_index::text, 0));
  select * into previous from public.backup_event_restore_batches
    where backup_id=p_backup_id and event_table=p_table and batch_index=p_index;
  if found then
    if previous.content_sha256 <> expected_sha or previous.row_count <> jsonb_array_length(p_rows) then
      raise exception 'Conflicting event batch replay refused';
    end if;
    return 0;
  end if;

  if p_table = 'activity_events' then
    insert into public.activity_events
      (student_id, category, event_type, entity_type, entity_id, attempt_id,
       is_correct, response, duration_ms, details, created_at)
    select student_id, category, event_type, entity_type, entity_id, attempt_id,
           is_correct, response, duration_ms, details, created_at
      from jsonb_populate_recordset(null::public.activity_events, p_rows);
  else
    insert into public.audit_logs
      (actor_type, actor_id, action, entity_type, entity_id, summary, details, ip, created_at)
    select actor_type, actor_id, action, entity_type, entity_id, summary, details, ip, created_at
      from jsonb_populate_recordset(null::public.audit_logs, p_rows);
  end if;

  inserted := jsonb_array_length(p_rows);
  insert into public.backup_event_restore_batches
    (backup_id,event_table,batch_index,row_count,content_sha256)
    values (p_backup_id,p_table,p_index,inserted,expected_sha);
  return inserted;
end $$;
revoke all on function public.restore_event_batch(uuid,text,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.restore_event_batch(uuid,text,integer,jsonb) to service_role;
notify pgrst, 'reload schema';
