-- V1.1 result embargo: student feedback stays hidden until an exam result
-- has been explicitly released. Existing non-exam teacher notes/feedback
-- without an exam attempt remain visible to their intended student.
-- This is additive and safe for existing V1 teacher/attempt IDs.
drop policy if exists "student reads feedback" on public.teacher_feedback;

-- SECURITY DEFINER isolates feedback's release-state lookup from ordinary
-- exam_attempts RLS; never grants the caller access to the attempt row.
create or replace function public.is_student_feedback_released(
  p_attempt_id uuid,
  p_student_id uuid
) returns boolean
language sql stable security definer
set search_path = public, pg_temp as $$
  select exists (
    select 1
    from public.exam_attempts a
    where a.id = p_attempt_id
      and a.student_id = p_student_id
      and a.result_released = true
      and a.reset_at is null
  )
$$;
revoke all on function public.is_student_feedback_released(uuid,uuid) from public, anon;
grant execute on function public.is_student_feedback_released(uuid,uuid) to authenticated, service_role;

create policy "student reads released feedback"
on public.teacher_feedback
for select to authenticated
using (
  student_id = public.current_student_id()
  and (
    (attempt_id is null and answer_id is null)
    or public.is_student_feedback_released(attempt_id, student_id)
  )
);
