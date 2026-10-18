-- Additive Lesson Mode foundation: existing catalog practice is unchanged.
-- Published snapshots are immutable except for status transition to superseded.
create table if not exists public.lesson_revisions (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  revision integer not null check (revision > 0),
  state text not null default 'draft'
    check (state in ('draft','published','superseded')),
  title text not null check (length(trim(title)) between 1 and 200),
  description text not null default '',
  sequential boolean not null default true,
  -- Backwards compatible: publishing a lesson does NOT alter ordinary catalog
  -- practice unless the teacher explicitly enables strict catalog locking.
  enforce_catalog_locks boolean not null default false,
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 100),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique(catalog_id, revision)
);
create unique index if not exists lesson_revisions_draft_by_catalog_uidx
  on public.lesson_revisions(catalog_id) where state='draft';
create unique index if not exists lesson_revisions_published_by_catalog_uidx
  on public.lesson_revisions(catalog_id) where state='published';
create index if not exists lesson_revisions_recent_idx
  on public.lesson_revisions(catalog_id,revision desc);

create table if not exists public.lesson_step_progress (
  revision_id uuid not null references public.lesson_revisions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  step_id text not null check (length(step_id) between 1 and 100),
  viewed_at timestamptz,
  attempted_at timestamptz,
  best_score_percent numeric(5,2)
    check (best_score_percent between 0 and 100),
  last_graded_event_id bigint references public.activity_events(id) on delete set null,
  teacher_approved boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (revision_id,student_id,step_id)
);
create index if not exists lesson_step_progress_student_idx
  on public.lesson_step_progress(student_id,updated_at desc);

-- A published revision is never mutated in place. Its sole permitted change
-- is the publication transaction superseding it, retaining historical grades.
create or replace function public.protect_published_lesson_revision()
returns trigger language plpgsql set search_path = public as $lesson_guard$
begin
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
drop trigger if exists trg_protect_published_lesson_revision
  on public.lesson_revisions;
create trigger trg_protect_published_lesson_revision
before insert or update on public.lesson_revisions
for each row execute function public.protect_published_lesson_revision();

alter table public.lesson_revisions enable row level security;
alter table public.lesson_step_progress enable row level security;
drop policy if exists "teacher manage lesson revisions" on public.lesson_revisions;
create policy "teacher manage lesson revisions" on public.lesson_revisions
  for all to authenticated using (public.is_teacher())
  with check (public.is_teacher());
drop policy if exists "teacher manage lesson progress" on public.lesson_step_progress;
create policy "teacher manage lesson progress" on public.lesson_step_progress
  for all to authenticated using (public.is_teacher())
  with check (public.is_teacher());

-- Student access is exclusively through checked server functions. RLS denies
-- raw table access to students; service role is only used after authorization.
grant all on public.lesson_revisions,public.lesson_step_progress to service_role;
grant select,insert,update,delete on public.lesson_revisions,public.lesson_step_progress to authenticated;

-- The sole publication transition is atomic; clients never update snapshots
-- directly. EXECUTE is restricted to server service role (not web users).
create or replace function public.publish_lesson_revision(
  p_catalog_id uuid, p_draft_id uuid
) returns uuid
language plpgsql set search_path = public
as $$
declare
  draft_row public.lesson_revisions%rowtype;
begin
  select * into draft_row from public.lesson_revisions
    where id=p_draft_id and catalog_id=p_catalog_id and state='draft'
    for update;
  if not found then raise exception 'Lesson draft not found or already published'; end if;

  perform 1 from public.catalogs
    where id=p_catalog_id and status='active' and deleted_at is null;
  if not found then raise exception 'Catalog is not active'; end if;

  perform set_config('fluentforge.lesson_publish', 'true', true);
  update public.lesson_revisions
    set state='superseded' where catalog_id=p_catalog_id and state='published';
  update public.lesson_revisions
    set state='published',published_at=now()
    where id=p_draft_id;
  return p_draft_id;
end;
$$;
revoke all on function public.publish_lesson_revision(uuid,uuid) from public;
revoke all on function public.publish_lesson_revision(uuid,uuid) from authenticated;
revoke all on function public.publish_lesson_revision(uuid,uuid) from anon;
grant execute on function public.publish_lesson_revision(uuid,uuid) to service_role;

-- Only authoritative activity_events written by the existing grader can
-- advance attempt/pass progress. Atomic GREATEST preserves scores across
-- concurrent student devices and duplicate submissions.
create or replace function public.record_lesson_step_grade(
  p_revision_id uuid,
  p_student_id uuid,
  p_step_id text,
  p_score_percent numeric,
  p_event_id bigint
) returns void language plpgsql
set search_path = public as $lesson_grade$
declare
  _event public.activity_events%rowtype;
  _catalog_id uuid;
  _entity_id uuid;
  _entity_type text;
  _expected_percent numeric;
begin
  if p_score_percent is not null and
     (p_score_percent < 0 or p_score_percent > 100) then
    raise exception 'Score percent out of bounds';
  end if;

  select * into _event from public.activity_events where id = p_event_id;
  if not found or _event.student_id is distinct from p_student_id
     or _event.category <> 'practice' then
    raise exception 'Trusted grading event is missing or belongs to another student';
  end if;

  select revision.catalog_id, item.entity_type, item.entity_id
    into _catalog_id, _entity_type, _entity_id
  from public.lesson_revisions revision
  join lateral jsonb_array_elements(revision.steps) step on true
  join public.catalog_items item
    on item.id = (step ->> 'itemId')::uuid
   and item.catalog_id = revision.catalog_id
  where revision.id = p_revision_id and revision.state = 'published'
    and step ->> 'id' = p_step_id and step ->> 'kind' = 'activity'
    -- View-mode steps are self-acknowledged and cannot receive fabricated
    -- grades from individual Reading/Listening questions.
    and step ->> 'mode' in ('attempt','pass');
  if not found then
    raise exception 'Lesson activity does not belong to the published revision';
  end if;

  if _event.details ->> 'catalog_id' is distinct from _catalog_id::text
     or _event.entity_id is distinct from _entity_id
     or _event.entity_type is distinct from _entity_type
     or not (
       (_entity_type = 'question' and _event.event_type = 'practice_answer')
       or (_entity_type = 'vocabulary' and _event.event_type in ('vocabulary_answer','vocabulary_rating'))
     ) then
    raise exception 'Grading event is unrelated to this lesson activity';
  end if;

  -- No score may be created for a flashcard rating or an ungraded answer.
  if _event.event_type = 'vocabulary_rating' and p_score_percent is not null then
    raise exception 'Vocabulary flashcards do not supply a graded score';
  end if;
  if _entity_type = 'vocabulary' and _event.event_type = 'vocabulary_answer'
     and p_score_percent is not null then
    _expected_percent := case when _event.is_correct then 100
      when _event.is_correct = false then 0 else null end;
    if _expected_percent is null or p_score_percent <> _expected_percent then
      raise exception 'Vocabulary score differs from verified answer result';
    end if;
  end if;
  if _entity_type = 'question' and p_score_percent is not null then
    if coalesce((_event.details ->> 'needs_review')::boolean,false)
       or not (_event.details ? 'score' and _event.details ? 'max_score')
       or coalesce((_event.details ->> 'max_score')::numeric,0) <= 0 then
      raise exception 'Question is ungraded or score evidence is missing';
    end if;
    _expected_percent := least(100, greatest(0,
      100 * (_event.details ->> 'score')::numeric /
      (_event.details ->> 'max_score')::numeric));
    if abs(_expected_percent - p_score_percent) > 0.01 then
      raise exception 'Lesson score differs from the canonical graded event';
    end if;
  end if;

  insert into public.lesson_step_progress(
    revision_id,student_id,step_id,attempted_at,
    best_score_percent,last_graded_event_id
  ) values (
    p_revision_id,p_student_id,p_step_id,now(),
    p_score_percent,p_event_id
  )
  on conflict (revision_id,student_id,step_id) do update set
    attempted_at=coalesce(public.lesson_step_progress.attempted_at,excluded.attempted_at),
    best_score_percent=case
      when excluded.best_score_percent is null then public.lesson_step_progress.best_score_percent
      when public.lesson_step_progress.best_score_percent is null then excluded.best_score_percent
      else greatest(public.lesson_step_progress.best_score_percent,excluded.best_score_percent)
    end,
    last_graded_event_id=greatest(
      coalesce(public.lesson_step_progress.last_graded_event_id,0),
      excluded.last_graded_event_id
    ),
    updated_at=now();
end;
$lesson_grade$;
revoke all on function public.record_lesson_step_grade(uuid,uuid,text,numeric,bigint) from public;
revoke all on function public.record_lesson_step_grade(uuid,uuid,text,numeric,bigint) from authenticated;
revoke all on function public.record_lesson_step_grade(uuid,uuid,text,numeric,bigint) from anon;
grant execute on function public.record_lesson_step_grade(uuid,uuid,text,numeric,bigint) to service_role;
