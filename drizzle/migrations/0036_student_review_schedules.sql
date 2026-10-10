-- V1.0 repeat calendar for teacher-graded question and vocabulary attempts.
-- Never create trust-bearing schedule mutations from arbitrary client INSERTs
-- into activity_events: student activity INSERT policy is intentionally broader.
-- Only a server role can invoke record_review_from_event(bigint).

create table if not exists public.student_review_schedules (
  student_id uuid not null references public.students(id) on delete cascade,
  entity_type text not null check (entity_type in ('question', 'vocabulary')),
  entity_id uuid not null,
  step integer not null default 0 check (step >= 0 and step <= 9),
  interval_days integer not null default 0 check (interval_days >= 0 and interval_days <= 365),
  lapses integer not null default 0 check (lapses >= 0),
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  last_event_id bigint references public.activity_events(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (student_id, entity_type, entity_id)
);

create index if not exists student_review_due_idx
  on public.student_review_schedules(student_id, due_at, entity_type);
create index if not exists student_review_entity_idx
  on public.student_review_schedules(entity_type, entity_id);

alter table public.student_review_schedules enable row level security;

drop policy if exists "teacher full access" on public.student_review_schedules;
create policy "teacher full access" on public.student_review_schedules
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

drop policy if exists "student reads own review schedule" on public.student_review_schedules;
create policy "student reads own review schedule" on public.student_review_schedules
  for select to authenticated
  using (student_id = public.current_student_id());

grant select on public.student_review_schedules to authenticated;
grant all on public.student_review_schedules to service_role;

create or replace function public.record_review_from_event(p_event_id bigint)
returns void language plpgsql security definer
set search_path = public as $$
declare
  e public.activity_events%rowtype;
  previous public.student_review_schedules%rowtype;
  target_step integer;
  target_days integer;
begin
  select * into e from public.activity_events where id = p_event_id;
  if not found then raise exception 'Unknown activity event'; end if;
  if e.category <> 'practice'
     or e.student_id is null
     or e.entity_id is null
     or e.entity_type not in ('question', 'vocabulary')
     or e.is_correct is null
     or (
       (e.entity_type = 'question' and e.event_type <> 'practice_answer')
       or (e.entity_type = 'vocabulary' and e.event_type <> 'vocabulary_answer')
     )
     or coalesce((e.details->>'needs_review')::boolean, false) then
    return;
  end if;

  insert into public.student_review_schedules (
    student_id, entity_type, entity_id, due_at
  ) values (e.student_id, e.entity_type, e.entity_id, e.created_at)
  on conflict (student_id, entity_type, entity_id) do nothing;

  select * into previous
  from public.student_review_schedules
  where student_id = e.student_id and entity_type = e.entity_type and entity_id = e.entity_id
  for update;

  -- Request retries and out-of-order postbacks cannot rewind progress.
  if previous.last_event_id is not null and p_event_id <= previous.last_event_id then
    return;
  end if;

  if e.is_correct and previous.due_at > e.created_at then
    -- Early extra practice is allowed, but must not accelerate the schedule.
    update public.student_review_schedules
      set last_event_id = e.id, updated_at = now()
      where student_id = e.student_id and entity_type = e.entity_type
      and entity_id = e.entity_id;
    return;
  end if;

  if e.is_correct then
    target_step := least(previous.step + 1, 9);
    target_days := (array[1,3,7,14,30,60,120,240,365])[target_step];
  else
    target_step := 0;
    target_days := 1;
  end if;

  update public.student_review_schedules
    set step = target_step,
        interval_days = target_days,
        lapses = previous.lapses + case when e.is_correct then 0 else 1 end,
        last_reviewed_at = e.created_at,
        due_at = e.created_at + make_interval(days => target_days),
        last_event_id = e.id,
        updated_at = now()
    where student_id = e.student_id and entity_type = e.entity_type
      and entity_id = e.entity_id;
end;
$$;

revoke all on function public.record_review_from_event(bigint)
  from public, anon, authenticated;
grant execute on function public.record_review_from_event(bigint) to service_role;
