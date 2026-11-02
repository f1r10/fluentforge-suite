-- Safeguard polymorphic entity references that cannot use a conventional
-- PostgreSQL FK. Fail if referenced teaching content belongs to another
-- workspace, including when the caller bypasses RLS.
create or replace function public.check_tenant_polymorphic_entity()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $ten_poly$
declare
  target_table text;
  matched boolean;
begin
  target_table := case new.entity_type
    when 'question' then 'questions'
    when 'vocabulary' then 'vocabulary_entries'
    when 'reading' then 'readings'
    when 'listening' then 'listenings'
    when 'catalog' then 'catalogs'
    else null
  end;
  if target_table is null then
    raise foreign_key_violation using message =
      'Unsupported polymorphic content entity';
  end if;
  if new.entity_id is null or new.workspace_id is null then
    raise foreign_key_violation using message =
      'Missing content entity or workspace';
  end if;
  execute format('select exists(select 1 from public.%I where id=$1 and workspace_id=$2)',target_table)
    into matched using new.entity_id,new.workspace_id;
  if not matched then
    raise foreign_key_violation using message =
      'Cross-workspace content reference is forbidden';
  end if;
  return new;
end;
$ten_poly$;

revoke all on function public.check_tenant_polymorphic_entity() from public,anon,authenticated;
grant execute on function public.check_tenant_polymorphic_entity() to service_role;

drop trigger if exists catalog_items_tenant_entity_guard on public.catalog_items;
create trigger catalog_items_tenant_entity_guard
 before insert or update of entity_id,entity_type,workspace_id on public.catalog_items
 for each row execute function public.check_tenant_polymorphic_entity();

drop trigger if exists exam_items_tenant_entity_guard on public.exam_items;
create trigger exam_items_tenant_entity_guard
 before insert or update of entity_id,entity_type,workspace_id on public.exam_items
 for each row when (new.entity_id is not null)
 execute function public.check_tenant_polymorphic_entity();

drop trigger if exists source_collection_tenant_entity_guard on public.source_collection_items;
create trigger source_collection_tenant_entity_guard
 before insert or update of entity_id,entity_type,workspace_id on public.source_collection_items
 for each row execute function public.check_tenant_polymorphic_entity();
