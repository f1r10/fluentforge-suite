-- Bulk-link imported entities back to review rows without building very large
-- PostgREST .in(...) filters or issuing one HTTP update per item.
create or replace function public.bulk_link_import_entities(_links jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _updated integer := 0;
begin
  if _links is null or jsonb_typeof(_links) <> 'array' then
    raise exception 'links must be a JSON array';
  end if;

  with links as (
    select *
    from jsonb_to_recordset(_links)
      as x(item_id uuid, entity_id uuid)
  )
  update public.import_items i
  set created_entity_id = links.entity_id
  from links
  where i.id = links.item_id
    and i.created_entity_id is null;

  get diagnostics _updated = row_count;
  return _updated;
end;
$$;

revoke all on function public.bulk_link_import_entities(jsonb) from public;
grant execute on function public.bulk_link_import_entities(jsonb) to service_role;

notify pgrst, 'reload schema';
