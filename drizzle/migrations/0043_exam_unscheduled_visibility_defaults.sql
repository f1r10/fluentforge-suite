-- Draft exams without a global closing time cannot use "after_close"
-- visibility semantics. Older defaults used after_close, which made otherwise
-- valid unscheduled exams impossible to publish. Repair only draft exams with
-- no close time and preserve any explicit non-after_close teacher choices.

update public.exams
set settings =
  jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(settings, '{}'::jsonb),
        '{result_release}',
        to_jsonb(
          case
            when coalesce(settings->>'result_release', 'after_close') = 'after_close'
              then 'after_approval'
            else settings->>'result_release'
          end
        ),
        true
      ),
      '{answer_visibility}',
      to_jsonb(
        case
          when coalesce(settings->>'answer_visibility', 'after_close') = 'after_close'
            then 'after_approval'
          else settings->>'answer_visibility'
        end
      ),
      true
    ),
    '{explanation_visibility}',
    to_jsonb(
      case
        when coalesce(settings->>'explanation_visibility', 'after_close') = 'after_close'
          then 'after_approval'
        else settings->>'explanation_visibility'
      end
    ),
    true
  ),
  updated_at = now()
where status = 'draft'
  and available_until is null
  and (
    coalesce(settings->>'result_release', 'after_close') = 'after_close'
    or coalesce(settings->>'answer_visibility', 'after_close') = 'after_close'
    or coalesce(settings->>'explanation_visibility', 'after_close') = 'after_close'
  );

notify pgrst, 'reload schema';
