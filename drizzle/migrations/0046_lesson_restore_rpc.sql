-- Additive repair. Do not mutate migration 0039's applied checksum.
-- V2 backups can contain published/superseded lesson revisions. The normal
-- publication trigger rejects their INSERT: only a service-role restore RPC
-- may bypass that guard, and only within its own transaction.
create or replace function public.protect_published_lesson_revision()
returns trigger language plpgsql set search_path = public as $lesson_guard$
begin
  -- This flag is only set by the service-role restore RPC below.
  if current_setting('fluentforge.lesson_restore', true) = 'true' then
    return new;
  end if;
  if TG_OP = 'INSERT' then
    if new.state <> 'draft' then
      raise exception 'Lesson revisions must start as draft';
    end if;
  elsif old.state = 'draft' then
    -- Draft content is editable, but its identity and revision must be stable.
    if (old.id, old.catalog_id, old.revision, old.created_at)
       is distinct from
       (new.id, new.catalog_id, new.revision, new.created_at) then
      raise exception 'Lesson draft identity and revision cannot change';
    end if;
    if new.state = 'published' then
      if current_setting('fluentforge.lesson_publish', true) is distinct from 'true' then
        raise exception 'Use the lesson publication workflow';
      end if;
    elsif new.state <> 'draft' then
      raise exception 'Invalid lesson draft state transition';
    end if;
  elsif old.state in ('published','superseded') then
    if not (old.state='published' and new.state='superseded'
      and current_setting('fluentforge.lesson_publish', true) = 'true'
      and (old.id,old.catalog_id,old.revision,old.title,old.description,
           old.sequential,old.enforce_catalog_locks,old.steps,old.created_at,old.published_at)
       is not distinct from
          (new.id,new.catalog_id,new.revision,new.title,new.description,
           new.sequential,new.enforce_catalog_locks,new.steps,new.created_at,new.published_at)) then
      raise exception 'Published lesson revisions are immutable';
    end if;
  end if;
  return new;
end;
$lesson_guard$;

create or replace function public.restore_lesson_revision_rows(p_rows jsonb)
returns integer
language plpgsql security definer set search_path = public
as $lesson_restore$
declare
  item jsonb;
  prior public.lesson_revisions%rowtype;
  count_rows integer := 0;
  incoming_id uuid;
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
    select * into prior from public.lesson_revisions
      where id=incoming_id for update;
    if found then
      -- Safe retry: never overwrite a published snapshot with differing data.
      if prior.catalog_id is distinct from (item->>'catalog_id')::uuid
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

notify pgrst, 'reload schema';
