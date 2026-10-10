-- Compatibility constraints for PostgREST/Supabase upsert conflict inference.
-- Existing partial unique indexes remain useful, but ON CONFLICT(column_list)
-- cannot reliably infer them. These non-partial unique indexes preserve the
-- same non-null uniqueness while allowing multiple NULL rows.

create unique index if not exists catalog_assignments_group_conflict_uidx
  on public.catalog_assignments(catalog_id, group_id);

create unique index if not exists catalog_assignments_student_conflict_uidx
  on public.catalog_assignments(catalog_id, student_id);

create unique index if not exists exam_assignments_group_conflict_uidx
  on public.exam_assignments(exam_id, group_id);

create unique index if not exists exam_assignments_student_conflict_uidx
  on public.exam_assignments(exam_id, student_id);

create unique index if not exists notifications_dedupe_key_conflict_uidx
  on public.notifications(dedupe_key);
