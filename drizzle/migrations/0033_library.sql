-- Teacher-managed library of downloadable/viewable books and study documents.

create table if not exists public.library_categories (
  id uuid primary key default gen_random_uuid(),
  system_key text unique,
  name text not null,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (
    system_key is null
    or system_key in ('tests', 'vocabulary', 'listenings', 'readings', 'exams')
  )
);

create table if not exists public.library_books (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.library_categories(id) on delete restrict,
  media_id uuid not null references public.media_assets(id) on delete restrict,
  title text not null,
  author text,
  description text,
  learning_language text,
  level text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  allow_download boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists library_categories_visible_sort_idx
  on public.library_categories(is_visible, sort_order, name)
  where deleted_at is null;

create index if not exists library_books_category_sort_idx
  on public.library_books(category_id, sort_order, created_at desc)
  where deleted_at is null;

create index if not exists library_books_status_idx
  on public.library_books(status, created_at desc)
  where deleted_at is null;

insert into public.library_categories (system_key, name, sort_order, is_visible)
values
  ('tests', 'Tests', 0, true),
  ('vocabulary', 'Vocabulary', 10, true),
  ('listenings', 'Listenings', 20, true),
  ('readings', 'Readings', 30, true),
  ('exams', 'Exams', 40, true)
on conflict (system_key) do update
set
  name = excluded.name,
  sort_order = excluded.sort_order,
  deleted_at = null;

alter table public.library_categories enable row level security;
alter table public.library_books enable row level security;

drop policy if exists "teacher full access" on public.library_categories;
create policy "teacher full access" on public.library_categories
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

drop policy if exists "students read visible library categories" on public.library_categories;
create policy "students read visible library categories"
  on public.library_categories
  for select to authenticated
  using (
    public.current_student_id() is not null
    and is_visible = true
    and deleted_at is null
  );

drop policy if exists "teacher full access" on public.library_books;
create policy "teacher full access" on public.library_books
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

drop policy if exists "students read active library books" on public.library_books;
create policy "students read active library books"
  on public.library_books
  for select to authenticated
  using (
    public.current_student_id() is not null
    and status = 'active'
    and deleted_at is null
    and exists (
      select 1
      from public.library_categories lc
      where lc.id = library_books.category_id
        and lc.is_visible = true
        and lc.deleted_at is null
    )
  );

grant select, insert, update, delete on public.library_categories to authenticated;
grant select, insert, update, delete on public.library_books to authenticated;
grant all on public.library_categories, public.library_books to service_role;
