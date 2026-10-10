insert into public.system_settings(key, value, is_public)
values (
  'backup_schedule',
  '{"enabled":false,"interval_hours":24,"retention_count":7}'::jsonb,
  false
)
on conflict (key) do nothing;

create or replace function public.claim_scheduled_backup(
  p_interval_hours integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_interval integer;
begin
  v_interval := greatest(1, least(coalesce(p_interval_hours, 24), 720));

  perform pg_advisory_xact_lock(hashtext('fluentforge:scheduled-backup'));

  if exists (
    select 1
    from public.backups
    where kind = 'scheduled'
      and status in ('queued', 'processing')
  ) then
    return null;
  end if;

  if exists (
    select 1
    from public.backups
    where kind = 'scheduled'
      and created_at > now() - make_interval(hours => v_interval)
  ) then
    return null;
  end if;

  insert into public.backups(
    kind,
    status,
    manifest,
    restore_state
  )
  values (
    'scheduled',
    'processing',
    '{}'::jsonb,
    '{}'::jsonb
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.claim_scheduled_backup(integer)
  from public, anon, authenticated;
grant execute on function public.claim_scheduled_backup(integer)
  to service_role;
