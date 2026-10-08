-- Persistent learner state for vocabulary practice.
-- Event history remains in activity_events; this table stores the current
-- compact state needed for practice UX and future spaced-repetition logic.

create table if not exists public.student_vocabulary_state (
  student_id uuid not null references public.students(id) on delete cascade,
  entry_id uuid not null references public.vocabulary_entries(id) on delete cascade,
  state text not null default 'new'
    check (state in ('new', 'learning', 'known')),
  correct_count integer not null default 0 check (correct_count >= 0),
  incorrect_count integer not null default 0 check (incorrect_count >= 0),
  correct_streak integer not null default 0 check (correct_streak >= 0),
  last_result boolean,
  last_mode text,
  last_practiced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (student_id, entry_id)
);

create index if not exists student_vocabulary_state_entry_idx
  on public.student_vocabulary_state(entry_id);

create index if not exists student_vocabulary_state_student_state_idx
  on public.student_vocabulary_state(student_id, state);

alter table public.student_vocabulary_state enable row level security;

drop policy if exists "teacher full access" on public.student_vocabulary_state;
create policy "teacher full access" on public.student_vocabulary_state
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

drop policy if exists "student reads own vocabulary state" on public.student_vocabulary_state;
create policy "student reads own vocabulary state" on public.student_vocabulary_state
  for select to authenticated
  using (student_id = public.current_student_id());

grant select on public.student_vocabulary_state to authenticated;
grant all on public.student_vocabulary_state to service_role;
