-- Dictation attempts are teacher-readable. Students cannot read answer
-- transcripts from the table directly: feedback is released by the app.
create table if not exists public.listening_dictation_attempts (
  id uuid primary key,
  student_id uuid not null references public.students(id) on delete cascade,
  listening_id uuid not null references public.listenings(id) on delete restrict,
  transcript_snapshot text not null,
  response_text text not null,
  score_percent integer not null check (score_percent between 0 and 100),
  error_count integer not null check (error_count >= 0),
  expected_words integer not null check (expected_words >= 1),
  feedback jsonb not null default '[]'::jsonb,
  show_feedback boolean not null default true,
  submitted_at timestamptz not null default now()
);
create index if not exists listening_dictation_student_recent_idx
  on public.listening_dictation_attempts(student_id, submitted_at desc);
create index if not exists listening_dictation_listening_idx
  on public.listening_dictation_attempts(listening_id, submitted_at desc);

alter table public.listening_dictation_attempts enable row level security;
drop policy if exists "teacher full access" on public.listening_dictation_attempts;
create policy "teacher full access" on public.listening_dictation_attempts
  for all to authenticated using (public.is_teacher())
  with check (public.is_teacher());
grant all on public.listening_dictation_attempts to service_role;
grant select, insert, update, delete on public.listening_dictation_attempts to authenticated;
