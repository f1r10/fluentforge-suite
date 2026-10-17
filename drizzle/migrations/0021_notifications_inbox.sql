alter table public.notifications
  add column if not exists dedupe_key text;

create unique index if not exists notifications_dedupe_key_uidx
  on public.notifications(dedupe_key)
  where dedupe_key is not null;

create index if not exists notifications_teacher_unread_created_idx
  on public.notifications(created_at desc)
  where recipient_type = 'teacher' and read_at is null;

create index if not exists notifications_student_created_idx
  on public.notifications(student_id, created_at desc)
  where recipient_type = 'student';

create unique index if not exists question_reports_student_question_open_uidx
  on public.question_reports(student_id, question_id)
  where resolved_at is null;
