-- Guarantee exactly one learning-activity event per dictation submission,
-- in the same transaction as the attempt. A failed event write rolls back the
-- attempt; retries by UUID cannot create duplicate activity events.
create or replace function public.log_listening_dictation_attempt()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.activity_events (
    student_id, category, event_type, entity_type, entity_id,
    is_correct, response, duration_ms, details
  ) values (
    new.student_id, 'practice', 'dictation_answer', 'listening',
    new.listening_id, new.score_percent = 100,
    jsonb_build_object('value', new.response_text),
    0,
    jsonb_build_object(
      'attempt_id', new.id,
      'score', new.score_percent,
      'error_count', new.error_count,
      'expected_words', new.expected_words
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_log_listening_dictation_attempt
  on public.listening_dictation_attempts;
create trigger trg_log_listening_dictation_attempt
after insert on public.listening_dictation_attempts
for each row execute function public.log_listening_dictation_attempt();
