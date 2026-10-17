-- Additive Lesson Mode V1: immutable ordered catalog snapshots and student view evidence.
-- Legacy catalog practice is deliberately unaffected until the separate lock-
-- enforcement acceptance is complete.
create table if not exists public.lesson_drafts (
  catalog_id uuid primary key references public.catalogs(id) on delete cascade,
  sequential boolean not null default true,
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array'),
  updated_at timestamptz not null default now()
);

create table if not exists public.lesson_publications (
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  revision integer not null check (revision > 0),
  title text not null,
  sequential boolean not null default true,
  steps jsonb not null check (jsonb_typeof(steps) = 'array'),
  published_at timestamptz not null default now(),
  primary key (catalog_id, revision)
);
create index if not exists lesson_publications_latest_idx
  on public.lesson_publications(catalog_id, revision desc);

create table if not exists public.student_lesson_views (
  student_id uuid not null references public.students(id) on delete cascade,
  catalog_id uuid not null,
  revision integer not null,
  step_id uuid not null,
  viewed_at timestamptz not null default now(),
  primary key (student_id, catalog_id, revision, step_id),
  foreign key (catalog_id, revision)
    references public.lesson_publications(catalog_id, revision) on delete cascade
);
create index if not exists student_lesson_views_lookup_idx
  on public.student_lesson_views(student_id, catalog_id, revision);

alter table public.lesson_drafts enable row level security;
alter table public.lesson_publications enable row level security;
alter table public.student_lesson_views enable row level security;
revoke all on public.lesson_drafts, public.lesson_publications,
  public.student_lesson_views from anon, authenticated;
grant all on public.lesson_drafts, public.lesson_publications,
  public.student_lesson_views to service_role;

-- Single atomic publication: the DB locks the catalog while it creates a
-- new revision, and copies membership/versions from canonical catalog rows.
-- This avoids revision races and client-forged content identifiers.
create or replace function public.publish_catalog_lesson(_catalog_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  _draft public.lesson_drafts%rowtype;
  _catalog public.catalogs%rowtype;
  _revision integer;
  _count integer;
  _verified integer;
  _snapshot jsonb;
begin
  select * into _catalog from public.catalogs
    where id = _catalog_id and deleted_at is null and status = 'active'
    for update;
  if not found then raise exception 'Only active catalogs can publish lessons'; end if;

  select * into _draft from public.lesson_drafts where catalog_id = _catalog_id;
  if not found then raise exception 'Save a lesson draft first'; end if;
  _count := jsonb_array_length(_draft.steps);
  if _count < 1 or _count > 100 then
    raise exception 'Lessons must contain 1 to 100 steps';
  end if;

  with input as (
    select value as step, ordinality as position
    from jsonb_array_elements(_draft.steps) with ordinality
  ), matched as (
    select input.position, input.step, ci.id, ci.entity_type,
      ci.entity_id, q.current_version as question_version
    from input
    left join public.catalog_items ci
      on ci.id = (input.step ->> 'id')::uuid
      and ci.catalog_id = _catalog_id
    left join public.questions q
      on ci.entity_type = 'question' and ci.entity_id = q.id
      and q.status = 'active' and q.deleted_at is null
    left join public.vocabulary_entries v
      on ci.entity_type = 'vocabulary' and ci.entity_id = v.id
      and v.status = 'active' and v.deleted_at is null
    left join public.readings r
      on ci.entity_type = 'reading' and ci.entity_id = r.id
      and r.status = 'active' and r.deleted_at is null
    left join public.listenings l
      on ci.entity_type = 'listening' and ci.entity_id = l.id
      and l.status = 'active' and l.deleted_at is null
    where ci.id is not null and (
      (ci.entity_type = 'question' and q.id is not null) or
      (ci.entity_type = 'vocabulary' and v.id is not null) or
      (ci.entity_type = 'reading' and r.id is not null) or
      (ci.entity_type = 'listening' and l.id is not null)
    )
  )
  select count(*), jsonb_agg(
    (step - 'id') || jsonb_build_object(
      'id', id, 'entity_type', entity_type,
      'entity_id', entity_id, 'question_version', question_version
    ) order by position
  ) into _verified, _snapshot from matched;

  if _verified <> _count then
    raise exception 'Lesson contains unavailable or unassigned catalog content';
  end if;
  if (select count(distinct elem ->> 'id')
      from jsonb_array_elements(_draft.steps) elem) <> _count then
    raise exception 'Lesson step IDs must be unique';
  end if;

  select coalesce(max(revision),0) + 1 into _revision
    from public.lesson_publications where catalog_id = _catalog_id;

  insert into public.lesson_publications
    (catalog_id, revision, title, sequential, steps)
  values (_catalog_id, _revision, _catalog.name, _draft.sequential, _snapshot);
  return _revision;
end;
$$;
revoke all on function public.publish_catalog_lesson(uuid)
  from public, anon, authenticated;
grant execute on function public.publish_catalog_lesson(uuid) to service_role;

-- Publications cannot be silently edited. A new version must be published.
create or replace function public.prevent_lesson_publication_change()
returns trigger language plpgsql as $$
begin
  raise exception 'Published lessons are immutable; publish a new revision';
end;
$$;
drop trigger if exists lesson_publication_immutable
  on public.lesson_publications;
create trigger lesson_publication_immutable
  before update on public.lesson_publications
  for each row execute function public.prevent_lesson_publication_change();

notify pgrst, 'reload schema';
