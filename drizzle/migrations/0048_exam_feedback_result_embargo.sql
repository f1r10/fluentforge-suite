-- V1.1 result embargo: student feedback stays hidden until an exam result
-- has been explicitly released. Existing non-exam teacher notes/feedback
-- without an exam attempt remain visible to their intended student.
-- This is additive and safe for existing V1 teacher/attempt IDs.
drop policy if exists "student reads feedback" on public.teacher_feedback;

create policy "student reads released feedback"
on public.teacher_feedback
for select to authenticated
using (
  student_id = public.current_student_id()
  and (
    (attempt_id is null and answer_id is null)
    or exists (
      select 1
      from public.exam_attempts a
      where a.id = teacher_feedback.attempt_id
        and a.student_id = teacher_feedback.student_id
        and a.result_released = true
        and a.reset_at is null
    )
  )
);
