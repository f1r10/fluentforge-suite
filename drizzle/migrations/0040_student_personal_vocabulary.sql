-- Student-owned vocabulary notebook populated from dictionary search.
-- This stays separate from the teacher's global vocabulary bank.

create table if not exists public.student_personal_vocabulary (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  word text not null,
  learning_language text not null default 'en',
  definition text,
  ipa text,
  part_of_speech text,
  level text,
  translations jsonb not null default '[]'::jsonb,
  synonyms text[] not null default '{}',
  antonyms text[] not null default '{}',
  examples jsonb not null default '[]'::jsonb,
  lexical_metadata jsonb not null default '{}'::jsonb,
  source text not null default 'dictionary',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists student_personal_vocab_unique_word_idx
  on public.student_personal_vocabulary (
    student_id,
    learning_language,
    lower(btrim(word))
  );

create index if not exists student_personal_vocab_student_updated_idx
  on public.student_personal_vocabulary(student_id, updated_at desc);

alter table public.student_personal_vocabulary enable row level security;

drop policy if exists "teacher full access" on public.student_personal_vocabulary;
create policy "teacher full access" on public.student_personal_vocabulary
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

drop policy if exists "student reads own personal vocabulary" on public.student_personal_vocabulary;
create policy "student reads own personal vocabulary"
  on public.student_personal_vocabulary
  for select to authenticated
  using (student_id = public.current_student_id());

grant select on public.student_personal_vocabulary to authenticated;
grant all on public.student_personal_vocabulary to service_role;

notify pgrst, 'reload schema';
