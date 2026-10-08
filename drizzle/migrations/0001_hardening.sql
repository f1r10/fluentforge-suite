-- Core integrity hardening.
-- This migration is intentionally additive so existing Lovable Cloud databases
-- can apply it without replaying the initial schema.

-- The first product version is single-teacher. Enforce it in PostgreSQL so
-- concurrent first-run requests cannot create two admin rows.
create unique index if not exists admin_users_single_teacher_uidx
  on public.admin_users ((true));

-- User-facing identifiers are case-insensitive.
create unique index if not exists admin_users_username_lower_uidx
  on public.admin_users (lower(username));

create unique index if not exists students_username_lower_uidx
  on public.students (lower(username))
  where deleted_at is null;

create unique index if not exists tags_name_lower_uidx
  on public.tags (lower(name));

-- Basic question invariants belong in the database as a second line of defense.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_difficulty_range'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
      add constraint questions_difficulty_range
      check (difficulty is null or difficulty between 1 and 5);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'questions_current_version_positive'
      and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
      add constraint questions_current_version_positive
      check (current_version >= 1);
  end if;
end $$;

-- Historical question versions are immutable. They may still be removed only
-- through the question's cascading lifecycle, but cannot be edited in place.
create or replace function public.prevent_question_version_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'question_versions are immutable';
end;
$$;

drop trigger if exists trg_question_versions_immutable on public.question_versions;
create trigger trg_question_versions_immutable
before update on public.question_versions
for each row execute function public.prevent_question_version_update();

-- A group/student assignment must target exactly one recipient.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_assignments_one_target'
      and conrelid = 'public.catalog_assignments'::regclass
  ) then
    alter table public.catalog_assignments
      add constraint catalog_assignments_one_target
      check ((group_id is not null)::int + (student_id is not null)::int = 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'exam_assignments_one_target'
      and conrelid = 'public.exam_assignments'::regclass
  ) then
    alter table public.exam_assignments
      add constraint exam_assignments_one_target
      check ((group_id is not null)::int + (student_id is not null)::int = 1);
  end if;
end $$;

-- Avoid duplicate direct assignments.
create unique index if not exists catalog_assignments_group_uidx
  on public.catalog_assignments(catalog_id, group_id)
  where group_id is not null;

create unique index if not exists catalog_assignments_student_uidx
  on public.catalog_assignments(catalog_id, student_id)
  where student_id is not null;

create unique index if not exists exam_assignments_group_uidx
  on public.exam_assignments(exam_id, group_id)
  where group_id is not null;

create unique index if not exists exam_assignments_student_uidx
  on public.exam_assignments(exam_id, student_id)
  where student_id is not null;

-- Attempt numbers are unique per student/exam.
create unique index if not exists exam_attempts_student_number_uidx
  on public.exam_attempts(exam_id, student_id, attempt_number);

-- Recovery codes must never be duplicated within a set.
create unique index if not exists admin_recovery_codes_set_hash_uidx
  on public.admin_recovery_codes(set_id, code_hash);

-- Common operational indexes.
create index if not exists questions_status_updated_idx
  on public.questions(status, updated_at desc)
  where deleted_at is null;

create index if not exists students_status_last_active_idx
  on public.students(status, last_active_at desc)
  where deleted_at is null;

create index if not exists activity_events_created_idx
  on public.activity_events(created_at desc);

create index if not exists notifications_student_created_idx
  on public.notifications(student_id, created_at desc)
  where recipient_type = 'student';
