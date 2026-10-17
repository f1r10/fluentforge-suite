-- Catalog integrity and atomic ordering.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_items_entity_type_check'
      and conrelid = 'public.catalog_items'::regclass
  ) then
    alter table public.catalog_items
      add constraint catalog_items_entity_type_check
      check (entity_type in ('question', 'vocabulary', 'reading', 'listening'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_items_sort_order_nonnegative'
      and conrelid = 'public.catalog_items'::regclass
  ) then
    alter table public.catalog_items
      add constraint catalog_items_sort_order_nonnegative
      check (sort_order >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'catalogs_sort_order_nonnegative'
      and conrelid = 'public.catalogs'::regclass
  ) then
    alter table public.catalogs
      add constraint catalogs_sort_order_nonnegative
      check (sort_order >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'catalogs_not_own_parent'
      and conrelid = 'public.catalogs'::regclass
  ) then
    alter table public.catalogs
      add constraint catalogs_not_own_parent
      check (parent_id is null or parent_id <> id);
  end if;
end $$;

create index if not exists catalogs_parent_sort_idx
  on public.catalogs(parent_id, sort_order, name)
  where deleted_at is null;

create index if not exists catalog_items_catalog_sort_idx
  on public.catalog_items(catalog_id, sort_order, created_at);

create or replace function public.prevent_catalog_cycle()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  has_cycle boolean;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'A catalog cannot be its own parent';
  end if;

  with recursive parent_chain as (
    select c.id, c.parent_id
    from public.catalogs c
    where c.id = new.parent_id

    union all

    select c.id, c.parent_id
    from public.catalogs c
    join parent_chain p on c.id = p.parent_id
    where p.parent_id is not null
  )
  select exists (
    select 1 from parent_chain where id = new.id
  ) into has_cycle;

  if has_cycle then
    raise exception 'Catalog hierarchy cannot contain a cycle';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_catalog_no_cycle on public.catalogs;
create trigger trg_catalog_no_cycle
before insert or update of parent_id on public.catalogs
for each row execute function public.prevent_catalog_cycle();

create or replace function public.reorder_catalog_items(
  p_catalog_id uuid,
  p_item_ids uuid[]
)
returns void
language plpgsql
set search_path = public
as $$
declare
  expected_count integer;
  supplied_count integer;
  unique_count integer;
begin
  select count(*) into expected_count
  from public.catalog_items
  where catalog_id = p_catalog_id;

  supplied_count := coalesce(array_length(p_item_ids, 1), 0);

  select count(distinct x) into unique_count
  from unnest(coalesce(p_item_ids, array[]::uuid[])) as x;

  if supplied_count <> expected_count or unique_count <> expected_count then
    raise exception 'Reorder list must contain every catalog item exactly once';
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) as x
    left join public.catalog_items ci
      on ci.id = x and ci.catalog_id = p_catalog_id
    where ci.id is null
  ) then
    raise exception 'Reorder list contains an item outside this catalog';
  end if;

  update public.catalog_items ci
  set sort_order = u.ord - 1
  from unnest(p_item_ids) with ordinality as u(id, ord)
  where ci.catalog_id = p_catalog_id
    and ci.id = u.id;
end;
$$;

grant execute on function public.reorder_catalog_items(uuid, uuid[]) to authenticated, service_role;
