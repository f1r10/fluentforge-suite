-- Lesson Mode: additive tables. Normal catalog practice is unchanged.
-- Service-only writes: student clients cannot fabricate completion/grades.

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

create table if not exists public.student_lesson_attempts (
  id bigint generated always as identity primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  catalog_id uuid not null,
  revision integer not null,
  step_id uuid not null,
  activity_event_id bigint not null unique references public.activity_events(id) on delete cascade,
  score_percent numeric(6,3) not null check (score_percent >= 0 and score_percent <= 100),
  recorded_at timestamptz not null default now(),
  foreign key (catalog_id, revision)
    references public.lesson_publications(catalog_id, revision) on delete cascade
);
create index if not exists student_lesson_attempts_progress_idx
  on public.student_lesson_attempts(student_id, catalog_id, revision, step_id);

alter table public.lesson_drafts enable row level security;
alter table public.lesson_publications enable row level security;
alter table public.student_lesson_views enable row level security;
alter table public.student_lesson_attempts enable row level security;

revoke all on public.lesson_drafts, public.lesson_publications,
  public.student_lesson_views, public.student_lesson_attempts
  from public, anon, authenticated;
grant all on public.lesson_drafts, public.lesson_publications,
  public.student_lesson_views, public.student_lesson_attempts to service_role;

-- Atomic publication and catalog membership validation under catalog row lock.
create or replace function public.publish_catalog_lesson(_catalog_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  _catalog public.catalogs%rowtype;
  _draft public.lesson_drafts%rowtype;
  _count integer;
  _valid integer;
  _snapshot jsonb;
  _revision integer;
begin
  select * into _catalog from public.catalogs
   where id = _catalog_id and deleted_at is null and status = 'active'
   for update;
  if not found then
    raise exception 'Only active catalogs can publish a lesson';
  end if;

  select * into _draft from public.lesson_drafts where catalog_id = _catalog_id;
  if not found then
    raise exception 'Save the lesson draft first';
  end if;

  _count := jsonb_array_length(_draft.steps);
  if _count < 1 or _count > 100 then
    raise exception 'A lesson needs 1 to 100 steps';
  end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(_draft.steps)) <> _count then
    raise exception 'Lesson step IDs must be unique';
  end if;

  with input as (
    select value as step, ordinality as pos
    from jsonb_array_elements(_draft.steps) with ordinality
  ), matched as (
    select i.step, i.pos, ci.id, ci.entity_type, ci.entity_id,
           q.current_version as question_version
    from input i
    join public.catalog_items ci
      on ci.id = (i.step ->> 'id')::uuid and ci.catalog_id = _catalog_id
    left join public.questions q
      on ci.entity_type = 'question' and q.id = ci.entity_id
       and q.status = 'active' and q.deleted_at is null
    left join public.vocabulary_entries v
      on ci.entity_type = 'vocabulary' and v.id = ci.entity_id
       and v.status = 'active' and v.deleted_at is null
    left join public.readings r
      on ci.entity_type = 'reading' and r.id = ci.entity_id
       and r.status = 'active' and r.deleted_at is null
    left join public.listenings l
      on ci.entity_type = 'listening' and l.id = ci.entity_id
       and l.status = 'active' and l.deleted_at is null
    where (ci.entity_type = 'question' and q.id is not null)
       or (ci.entity_type = 'vocabulary' and v.id is not null)
       or (ci.entity_type = 'reading' and r.id is not null)
       or (ci.entity_type = 'listening' and l.id is not null)
  )
  select count(*), jsonb_agg(
    step || jsonb_build_object(
      'entity_type', entity_type, 'entity_id', entity_id,
      'question_version', question_version
    ) order by pos
  ) into _valid, _snapshot from matched;

  if _valid <> _count then
    raise exception 'Lesson contains an unavailable or unassigned catalog item';
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

-- Do not permit accidental replacement of already-published metadata.
create or replace function public.prevent_lesson_publication_update()
returns trigger language plpgsql as $$
begin
  raise exception 'Published lessons are immutable. Publish another revision.';
end;
$$;
drop trigger if exists lesson_publications_immutable on public.lesson_publications;
create trigger lesson_publications_immutable
 before update on public.lesson_publications
 for each row execute function public.prevent_lesson_publication_update();

notify pgrst, 'reload schema';
