-- Exam builder integrity and atomic ordering helpers.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'exams_duration_positive'
      and conrelid = 'public.exams'::regclass
  ) then
    alter table public.exams
      add constraint exams_duration_positive
      check (duration_minutes is null or duration_minutes > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exams_availability_order'
      and conrelid = 'public.exams'::regclass
  ) then
    alter table public.exams
      add constraint exams_availability_order
      check (
        available_from is null
        or available_until is null
        or available_until > available_from
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_sections_sort_nonnegative'
      and conrelid = 'public.exam_sections'::regclass
  ) then
    alter table public.exam_sections
      add constraint exam_sections_sort_nonnegative
      check (sort_order >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_items_sort_nonnegative'
      and conrelid = 'public.exam_items'::regclass
  ) then
    alter table public.exam_items
      add constraint exam_items_sort_nonnegative
      check (sort_order >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_items_points_nonnegative'
      and conrelid = 'public.exam_items'::regclass
  ) then
    alter table public.exam_items
      add constraint exam_items_points_nonnegative
      check (points is null or points >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_items_entity_type_check'
      and conrelid = 'public.exam_items'::regclass
  ) then
    alter table public.exam_items
      add constraint exam_items_entity_type_check
      check (entity_type in ('question', 'reading', 'listening', 'catalog'));
  end if;
end $$;

create index if not exists exam_sections_exam_sort_idx
  on public.exam_sections(exam_id, sort_order, id);

create index if not exists exam_items_exam_section_sort_idx
  on public.exam_items(exam_id, section_id, sort_order, id);

create or replace function public.reorder_exam_sections(
  p_exam_id uuid,
  p_section_ids uuid[]
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
  from public.exam_sections
  where exam_id = p_exam_id;

  supplied_count := coalesce(array_length(p_section_ids, 1), 0);

  select count(distinct x) into unique_count
  from unnest(coalesce(p_section_ids, array[]::uuid[])) as x;

  if supplied_count <> expected_count or unique_count <> expected_count then
    raise exception 'Reorder list must contain every exam section exactly once';
  end if;

  if exists (
    select 1
    from unnest(p_section_ids) as x
    left join public.exam_sections s
      on s.id = x and s.exam_id = p_exam_id
    where s.id is null
  ) then
    raise exception 'Reorder list contains a section outside this exam';
  end if;

  update public.exam_sections s
  set sort_order = u.ord - 1
  from unnest(p_section_ids) with ordinality as u(id, ord)
  where s.exam_id = p_exam_id
    and s.id = u.id;
end;
$$;

create or replace function public.reorder_exam_items(
  p_exam_id uuid,
  p_section_id uuid,
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
  from public.exam_items
  where exam_id = p_exam_id
    and section_id is not distinct from p_section_id;

  supplied_count := coalesce(array_length(p_item_ids, 1), 0);

  select count(distinct x) into unique_count
  from unnest(coalesce(p_item_ids, array[]::uuid[])) as x;

  if supplied_count <> expected_count or unique_count <> expected_count then
    raise exception 'Reorder list must contain every exam item exactly once';
  end if;

  if exists (
    select 1
    from unnest(p_item_ids) as x
    left join public.exam_items i
      on i.id = x
      and i.exam_id = p_exam_id
      and i.section_id is not distinct from p_section_id
    where i.id is null
  ) then
    raise exception 'Reorder list contains an item outside this exam section';
  end if;

  update public.exam_items i
  set sort_order = u.ord - 1
  from unnest(p_item_ids) with ordinality as u(id, ord)
  where i.exam_id = p_exam_id
    and i.section_id is not distinct from p_section_id
    and i.id = u.id;
end;
$$;

grant execute on function public.reorder_exam_sections(uuid, uuid[]) to authenticated, service_role;
grant execute on function public.reorder_exam_items(uuid, uuid, uuid[]) to authenticated, service_role;
