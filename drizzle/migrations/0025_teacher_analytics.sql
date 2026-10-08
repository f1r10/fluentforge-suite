create or replace function public.teacher_question_analytics(
  p_limit integer default 200
)
returns table(
  question_id uuid,
  prompt text,
  question_type text,
  attempts bigint,
  correct bigint,
  incorrect bigint,
  manual bigint,
  skips bigint,
  accuracy numeric,
  skip_rate numeric,
  avg_time_ms numeric,
  difficulty_suggestion text
)
language sql
stable
security definer
set search_path = public
as $$
  with answered as (
    select
      ae.entity_id as question_id,
      ae.is_correct,
      coalesce(ae.duration_ms, 0)::bigint as duration_ms
    from public.activity_events ae
    where ae.category = 'practice'
      and ae.event_type = 'practice_answer'
      and ae.entity_type = 'question'
      and ae.entity_id is not null

    union all

    select
      aa.question_id,
      aa.is_correct,
      coalesce(aa.time_spent_ms, 0)::bigint
    from public.attempt_answers aa
    join public.exam_attempts ea on ea.id = aa.attempt_id
    where aa.question_id is not null
      and ea.status <> 'in_progress'
  ),
  answer_stats as (
    select
      question_id,
      count(*)::bigint as attempts,
      count(*) filter (where is_correct = true)::bigint as correct,
      count(*) filter (where is_correct = false)::bigint as incorrect,
      count(*) filter (where is_correct is null)::bigint as manual,
      avg(duration_ms)::numeric as avg_time_ms
    from answered
    group by question_id
  ),
  skip_stats as (
    select
      entity_id as question_id,
      count(*)::bigint as skips
    from public.activity_events
    where entity_type = 'question'
      and event_type in (
        'practice_question_skipped',
        'exam_question_skipped'
      )
      and entity_id is not null
    group by entity_id
  ),
  combined as (
    select
      q.id,
      q.prompt,
      q.question_type,
      coalesce(a.attempts, 0)::bigint as attempts,
      coalesce(a.correct, 0)::bigint as correct,
      coalesce(a.incorrect, 0)::bigint as incorrect,
      coalesce(a.manual, 0)::bigint as manual,
      coalesce(s.skips, 0)::bigint as skips,
      case
        when coalesce(a.correct, 0) + coalesce(a.incorrect, 0) = 0 then null
        else
          coalesce(a.correct, 0)::numeric
          / (coalesce(a.correct, 0) + coalesce(a.incorrect, 0))::numeric
      end as accuracy,
      case
        when coalesce(a.attempts, 0) + coalesce(s.skips, 0) = 0 then null
        else
          coalesce(s.skips, 0)::numeric
          / (coalesce(a.attempts, 0) + coalesce(s.skips, 0))::numeric
      end as skip_rate,
      a.avg_time_ms
    from public.questions q
    left join answer_stats a on a.question_id = q.id
    left join skip_stats s on s.question_id = q.id
    where q.deleted_at is null
      and (
        coalesce(a.attempts, 0) > 0
        or coalesce(s.skips, 0) > 0
      )
  )
  select
    c.id,
    c.prompt,
    c.question_type,
    c.attempts,
    c.correct,
    c.incorrect,
    c.manual,
    c.skips,
    c.accuracy,
    c.skip_rate,
    c.avg_time_ms,
    case
      when c.correct + c.incorrect < 10 then null
      when c.accuracy >= 0.90 then 'too_easy'
      when c.accuracy <= 0.40 then 'too_hard'
      else null
    end as difficulty_suggestion
  from combined c
  order by (c.attempts + c.skips) desc, c.prompt
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.teacher_question_analytics(integer)
  from public, anon, authenticated;
grant execute on function public.teacher_question_analytics(integer)
  to service_role;

create or replace function public.teacher_catalog_analytics(
  p_limit integer default 200
)
returns table(
  catalog_id uuid,
  catalog_name text,
  sessions bigint,
  total_answered bigint,
  avg_accuracy numeric,
  avg_score_percent numeric,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    c.name,
    count(ae.id)::bigint as sessions,
    coalesce(
      sum(
        case
          when jsonb_typeof(ae.details -> 'answered') = 'number'
            then (ae.details ->> 'answered')::numeric
          else 0
        end
      ),
      0
    )::bigint as total_answered,
    avg(
      case
        when jsonb_typeof(ae.details -> 'accuracy') = 'number'
          then (ae.details ->> 'accuracy')::numeric
        else null
      end
    ) as avg_accuracy,
    avg(
      case
        when jsonb_typeof(ae.details -> 'score') = 'number'
          and jsonb_typeof(ae.details -> 'max_score') = 'number'
          and (ae.details ->> 'max_score')::numeric > 0
          then
            ((ae.details ->> 'score')::numeric
            / (ae.details ->> 'max_score')::numeric) * 100
        else null
      end
    ) as avg_score_percent,
    max(ae.created_at) as last_activity
  from public.catalogs c
  join public.activity_events ae
    on ae.entity_type = 'catalog'
   and ae.entity_id = c.id
   and ae.event_type = 'practice_finished'
  where c.deleted_at is null
  group by c.id, c.name
  order by sessions desc, c.name
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.teacher_catalog_analytics(integer)
  from public, anon, authenticated;
grant execute on function public.teacher_catalog_analytics(integer)
  to service_role;

create or replace function public.teacher_student_analytics(
  p_limit integer default 1000
)
returns table(
  student_id uuid,
  student_name text,
  username text,
  status public.student_status,
  last_active_at timestamptz,
  practice_answers bigint,
  practice_accuracy numeric,
  study_time_ms bigint,
  exam_attempts bigint,
  exam_accuracy_percent numeric,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with practice as (
    select
      student_id,
      count(*)::bigint as answers,
      case
        when count(*) filter (where is_correct is not null) = 0 then null
        else
          count(*) filter (where is_correct = true)::numeric
          / count(*) filter (where is_correct is not null)::numeric
      end as accuracy,
      coalesce(sum(duration_ms), 0)::bigint as time_ms,
      max(created_at) as last_activity
    from public.activity_events
    where category = 'practice'
      and event_type in ('practice_answer', 'vocabulary_practice')
    group by student_id
  ),
  exams as (
    select
      student_id,
      count(*)::bigint as attempts,
      avg(
        case
          when max_score is not null and max_score > 0 and score is not null
            then (score / max_score) * 100
          else null
        end
      ) as accuracy_percent,
      max(coalesce(submitted_at, started_at)) as last_activity
    from public.exam_attempts
    where status <> 'in_progress'
    group by student_id
  )
  select
    s.id,
    concat_ws(' ', s.first_name, s.last_name),
    s.username,
    s.status,
    s.last_active_at,
    coalesce(p.answers, 0)::bigint,
    p.accuracy,
    coalesce(p.time_ms, 0)::bigint,
    coalesce(e.attempts, 0)::bigint,
    e.accuracy_percent,
    greatest(
      coalesce(p.last_activity, '-infinity'::timestamptz),
      coalesce(e.last_activity, '-infinity'::timestamptz),
      coalesce(s.last_active_at, '-infinity'::timestamptz)
    ) as last_activity
  from public.students s
  left join practice p on p.student_id = s.id
  left join exams e on e.student_id = s.id
  where s.deleted_at is null
  order by last_activity desc, s.username
  limit greatest(1, least(coalesce(p_limit, 1000), 5000));
$$;

revoke all on function public.teacher_student_analytics(integer)
  from public, anon, authenticated;
grant execute on function public.teacher_student_analytics(integer)
  to service_role;
