-- Production hot-path indexes.
-- These are additive and target the filters/orderings used by the application.

create index if not exists questions_active_filter_idx
  on public.questions(
    status,
    learning_language,
    level,
    question_type,
    updated_at desc
  )
  where deleted_at is null;

create index if not exists exam_attempts_monitoring_idx
  on public.exam_attempts(exam_id, status, started_at desc);

create index if not exists exam_attempts_student_history_idx
  on public.exam_attempts(student_id, started_at desc);

create index if not exists activity_events_student_category_event_created_idx
  on public.activity_events(
    student_id,
    category,
    event_type,
    created_at desc
  );

create index if not exists import_jobs_status_created_idx
  on public.import_jobs(status, created_at desc);

create index if not exists media_assets_active_created_idx
  on public.media_assets(created_at desc)
  where deleted_at is null;

create index if not exists question_reports_unresolved_created_idx
  on public.question_reports(created_at desc)
  where resolved_at is null;
