-- Enforce matching workspace IDs across ordinary 1-column foreign keys.
-- A permissive service-role call cannot attach a child to another workspace's
-- parent even while bypassing RLS. Polymorphic entity_id relationships need
-- additional explicit validation in a later migration.
do $tenancy$
declare link record;
  unique_name text;
  guard_name text;
begin
 for link in
   select child.relname as child_table, parent.relname as parent_table,
     child_col.attname as child_column,
     parent_col.attname as parent_column, fk.conname
   from pg_constraint fk
   join pg_class child on child.oid=fk.conrelid
   join pg_namespace ns on ns.oid=child.relnamespace and ns.nspname='public'
   join pg_class parent on parent.oid=fk.confrelid
   join pg_namespace pns on pns.oid=parent.relnamespace and pns.nspname='public'
   join pg_attribute child_col on child_col.attrelid=child.oid
       and child_col.attnum=fk.conkey[1]
   join pg_attribute parent_col on parent_col.attrelid=parent.oid
       and parent_col.attnum=fk.confkey[1]
   where fk.contype='f' and array_length(fk.conkey,1)=1
     and array_length(fk.confkey,1)=1
     and exists(select 1 from pg_attribute a where a.attrelid=child.oid
       and a.attname='workspace_id' and not a.attisdropped)
     and exists(select 1 from pg_attribute a where a.attrelid=parent.oid
       and a.attname='workspace_id' and not a.attisdropped)
     and child_col.attname<>'workspace_id'
     and parent_col.attname<>'workspace_id'
 loop
   unique_name:= 'tenant_parent_'||substr(md5(link.parent_table||':'||link.parent_column),1,14);
   guard_name:= 'tenant_fk_'||substr(md5(link.child_table||':'||link.conname),1,14);
   execute format('create unique index if not exists %I on public.%I(workspace_id,%I)',
     unique_name,link.parent_table,link.parent_column);
   if not exists(select 1 from pg_constraint c
      where c.conrelid=format('public.%I',link.child_table)::regclass
        and c.conname=guard_name) then
      execute format('alter table public.%I add constraint %I foreign key(workspace_id,%I) references public.%I(workspace_id,%I)',
        link.child_table,guard_name,link.child_column,link.parent_table,link.parent_column);
   end if;
 end loop;
end
$tenancy$;
