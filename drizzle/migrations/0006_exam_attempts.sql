-- Exam attempt concurrency, autosave, and violation helpers.

create unique index if not exists exam_attempts_one_in_progress_uidx
  on public.exam_attempts(exam_id, student_id)
  where status = 'in_progress';

create index if not exists attempt_answers_attempt_updated_idx
  on public.attempt_answers(attempt_id, updated_at desc);

create index if not exists manual_reviews_pending_idx
  on public.manual_reviews(status, created_at)
  where status = 'pending';

create or replace function public.save_attempt_answer(
  p_attempt_id uuid,
  p_item_key text,
  p_question_id uuid,
  p_question_version integer,
  p_response jsonb,
  p_flagged boolean,
  p_time_spent_ms integer
)
returns public.attempt_answers
language plpgsql
set search_path = public
as $$
declare
  saved public.attempt_answers;
begin
  insert into public.attempt_answers(
    attempt_id,
    item_key,
    question_id,
    question_version,
    response,
    flagged,
    time_spent_ms
  )
  values (
    p_attempt_id,
    p_item_key,
    p_question_id,
    p_question_version,
    p_response,
    coalesce(p_flagged, false),
    greatest(coalesce(p_time_spent_ms, 0), 0)
  )
  on conflict (attempt_id, item_key)
  do update set
    question_id = excluded.question_id,
    question_version = excluded.question_version,
    response = excluded.response,
    flagged = excluded.flagged,
    time_spent_ms = greatest(public.attempt_answers.time_spent_ms, excluded.time_spent_ms),
    change_count = public.attempt_answers.change_count
      + case
          when public.attempt_answers.response is distinct from excluded.response then 1
          else 0
        end,
    updated_at = now()
  returning * into saved;

  return saved;
end;
$$;

create or replace function public.append_exam_violation(
  p_attempt_id uuid,
  p_event jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  next_value jsonb;
begin
  update public.exam_attempts
  set violations = coalesce(violations, '[]'::jsonb)
    || jsonb_build_array(
      coalesce(p_event, '{}'::jsonb)
      || jsonb_build_object('recorded_at', now())
    )
  where id = p_attempt_id
    and status = 'in_progress'
  returning violations into next_value;

  if next_value is null then
    raise exception 'Attempt is not active';
  end if;

  return next_value;
end;
$$;

revoke all on function public.save_attempt_answer(
  uuid, text, uuid, integer, jsonb, boolean, integer
) from public, anon, authenticated;
grant execute on function public.save_attempt_answer(
  uuid, text, uuid, integer, jsonb, boolean, integer
) to service_role;

revoke all on function public.append_exam_violation(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.append_exam_violation(uuid, jsonb)
  to service_role;
