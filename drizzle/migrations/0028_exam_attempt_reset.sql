alter table public.exam_attempts
  add column if not exists reset_at timestamptz,
  add column if not exists reset_by uuid;

create index if not exists exam_attempts_student_exam_active_idx
  on public.exam_attempts(student_id, exam_id, attempt_number desc)
  where reset_at is null;

create index if not exists exam_attempts_reset_idx
  on public.exam_attempts(reset_at desc)
  where reset_at is not null;
