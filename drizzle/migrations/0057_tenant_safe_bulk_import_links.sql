-- The V1 bulk-link RPC was service-role-only because it is SECURITY DEFINER.
-- Allow teacher-driven imports without granting an unrestricted cross-tenant
-- UPDATE capability. Links must point to vocabulary created from that exact
-- import item, job and workspace; forged or foreign links fail atomically.
create or replace function public.bulk_link_import_entities(_links jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  _updated integer := 0;
  _workspace uuid;
  _service boolean :=
    current_setting('request.jwt.claim.role', true) = 'service_role';
begin
  if _links is null or jsonb_typeof(_links) <> 'array'
     or jsonb_array_length(_links) > 500 then
    raise exception 'links must be a JSON array of at most 500 items';
  end if;

  if not _service then
    if not public.is_teacher() then
      raise exception 'Teacher authorization required' using errcode = '42501';
    end if;
    _workspace := public.current_workspace_id();
    if _workspace is null then
      raise exception 'Active workspace required' using errcode = '42501';
    end if;
  end if;

  if exists (
    with links as (
      select * from jsonb_to_recordset(_links)
        as x(item_id uuid, entity_id uuid)
    )
    select 1 from links l
    left join public.import_items i on i.id = l.item_id
    left join public.vocabulary_entries v on v.id = l.entity_id
    where l.item_id is null or l.entity_id is null
      or i.id is null or v.id is null
      or i.item_type <> 'vocabulary'
      or i.workspace_id is distinct from v.workspace_id
      or (not _service and i.workspace_id is distinct from _workspace)
      or v.provenance #>> '{import,import_item_id}' is distinct from i.id::text
      or v.provenance #>> '{import,job_id}' is distinct from i.job_id::text
      or (i.created_entity_id is not null and i.created_entity_id <> v.id)
  ) then
    raise exception 'Invalid or cross-workspace import link'
      using errcode = '42501';
  end if;

  with links as (
    select * from jsonb_to_recordset(_links)
      as x(item_id uuid, entity_id uuid)
  )
  update public.import_items i
    set created_entity_id = l.entity_id
    from links l
    where i.id = l.item_id
      and i.created_entity_id is null;

  get diagnostics _updated = row_count;
  return _updated;
end;
$$;

revoke all on function public.bulk_link_import_entities(jsonb)
  from public, anon, authenticated;
grant execute on function public.bulk_link_import_entities(jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';
