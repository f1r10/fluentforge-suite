-- Add a dedicated Books section to the teacher-managed Library.

alter table public.library_categories
  drop constraint if exists library_categories_system_key_check;

alter table public.library_categories
  add constraint library_categories_system_key_check
  check (
    system_key is null
    or system_key in (
      'books',
      'tests',
      'vocabulary',
      'listenings',
      'readings',
      'exams'
    )
  );

insert into public.library_categories (system_key, name, sort_order, is_visible)
values ('books', 'Books', 0, true)
on conflict (system_key) do update
set
  name = excluded.name,
  is_visible = true,
  deleted_at = null;

update public.library_categories
set sort_order = case system_key
  when 'books' then 0
  when 'tests' then 10
  when 'vocabulary' then 20
  when 'listenings' then 30
  when 'readings' then 40
  when 'exams' then 50
  else sort_order
end
where system_key is not null;
