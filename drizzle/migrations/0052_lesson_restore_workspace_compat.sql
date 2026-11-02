-- Preserve V1/V2 restore compatibility after workspace ownership backfill.
create or replace function public.restore_lesson_revision_rows(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public
as $lesson_restore$
declare
  item jsonb;
  prior public.lesson_revisions%rowtype;
  count_rows integer := 0;
  incoming_id uuid;
  owner_workspace uuid;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 250 then
    raise exception 'Invalid lesson restore batch';
  end if;

  -- Transaction-local: cannot leak to subsequent normal publication requests.
  perform set_config('fluentforge.lesson_restore','true',true);

  for item in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(item) <> 'object'
       or item->>'state' not in ('draft','published','superseded')
       or item->>'id' is null
       or item->>'catalog_id' is null
       or item->>'revision' is null then
      raise exception 'Invalid lesson backup record';
    end if;

    incoming_id := (item->>'id')::uuid;
    select workspace_id into owner_workspace
      from public.catalogs where id=(item->>'catalog_id')::uuid;
    if owner_workspace is null then
      raise exception 'Lesson backup catalog does not exist';
    end if;
    if item ? 'workspace_id' and (item->>'workspace_id')::uuid is distinct from owner_workspace then
      raise exception 'Lesson backup workspace mismatch';
    end if;
    item := item || jsonb_build_object('workspace_id',owner_workspace);
    select * into prior from public.lesson_revisions
      where id=incoming_id for update;
    if found then
      -- Safe retry: never overwrite a published snapshot with differing data.
      if prior.workspace_id is distinct from owner_workspace
         or prior.catalog_id is distinct from (item->>'catalog_id')::uuid
         or prior.revision is distinct from (item->>'revision')::integer
         or prior.state is distinct from item->>'state'
         or prior.title is distinct from item->>'title'
         or prior.description is distinct from item->>'description'
         or prior.sequential is distinct from (item->>'sequential')::boolean
         or prior.enforce_catalog_locks is distinct from (item->>'enforce_catalog_locks')::boolean
         or prior.steps is distinct from item->'steps'
         or prior.created_at is distinct from (item->>'created_at')::timestamptz
         or prior.published_at is distinct from nullif(item->>'published_at','')::timestamptz then
        raise exception 'Conflicting existing lesson revision %, refusing restore overwrite', incoming_id;
      end if;
      continue;
    end if;

    insert into public.lesson_revisions
      select (jsonb_populate_record(NULL::public.lesson_revisions, item)).*;
    count_rows := count_rows + 1;
  end loop;

  perform set_config('fluentforge.lesson_restore','false',true);
  return count_rows;
end;
$lesson_restore$;

revoke all on function public.restore_lesson_revision_rows(jsonb)
  from public, anon, authenticated;
grant execute on function public.restore_lesson_revision_rows(jsonb)
  to service_role;

