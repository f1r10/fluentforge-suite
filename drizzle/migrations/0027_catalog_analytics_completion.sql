drop function if exists public.teacher_catalog_analytics(integer);

create function public.teacher_catalog_analytics(
  p_limit integer default 200
)
returns table(
  catalog_id uuid,
  catalog_name text,
  content_items bigint,
  question_items bigint,
  vocabulary_items bigint,
  reading_items bigint,
  listening_items bigint,
  students_practiced bigint,
  sessions bigint,
  answer_attempts bigint,
  avg_accuracy numeric,
  avg_time_ms numeric,
  last_activity timestamptz,
  weak_topics jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with content as (
    select
      ci.catalog_id,
      count(*)::bigint as content_items,
      count(*) filter (where ci.entity_type = 'question')::bigint
        as question_items,
      count(*) filter (where ci.entity_type = 'vocabulary')::bigint
        as vocabulary_items,
      count(*) filter (where ci.entity_type = 'reading')::bigint
        as reading_items,
      count(*) filter (where ci.entity_type = 'listening')::bigint
        as listening_items
    from public.catalog_items ci
    group by ci.catalog_id
  ),
  catalog_events as (
    select
      ae.*,
      nullif(ae.details ->> 'catalog_id', '') as catalog_id_text,
      nullif(ae.details ->> 'session_id', '') as session_id_text
    from public.activity_events ae
    where ae.category = 'practice'
      and ae.details ? 'catalog_id'
  ),
  event_stats as (
    select
      c.id as catalog_id,
      count(distinct ce.student_id)::bigint as students_practiced,
      count(
        distinct concat_ws(
          ':',
          ce.student_id::text,
          ce.session_id_text
        )
      ) filter (
        where ce.session_id_text is not null
      )::bigint as sessions,
      count(*) filter (
        where ce.event_type in ('practice_answer', 'vocabulary_answer')
      )::bigint as answer_attempts,
      case
        when count(*) filter (
          where ce.event_type in ('practice_answer', 'vocabulary_answer')
            and ce.is_correct is not null
        ) = 0 then null
        else
          count(*) filter (
            where ce.event_type in ('practice_answer', 'vocabulary_answer')
              and ce.is_correct = true
          )::numeric
          /
          count(*) filter (
            where ce.event_type in ('practice_answer', 'vocabulary_answer')
              and ce.is_correct is not null
          )::numeric
      end as avg_accuracy,
      avg(ce.duration_ms) filter (
        where ce.event_type in ('practice_answer', 'vocabulary_answer')
          and ce.duration_ms is not null
      )::numeric as avg_time_ms,
      max(ce.created_at) as last_activity
    from public.catalogs c
    left join catalog_events ce
      on ce.catalog_id_text = c.id::text
    group by c.id
  ),
  topic_raw as (
    select
      ce.catalog_id_text::uuid as catalog_id,
      t.id as topic_id,
      t.name as topic_name,
      count(*) filter (
        where ce.is_correct is not null
      )::bigint as graded_attempts,
      count(*) filter (
        where ce.is_correct = true
      )::bigint as correct_answers
    from catalog_events ce
    join public.question_topics qt
      on qt.question_id = ce.entity_id
    join public.topics t
      on t.id = qt.topic_id
    where ce.event_type = 'practice_answer'
      and ce.entity_type = 'question'
      and ce.entity_id is not null
      and ce.catalog_id_text ~* '^[0-9a-f-]{36}$'
    group by ce.catalog_id_text, t.id, t.name
  ),
  topic_ranked as (
    select
      tr.*,
      case
        when tr.graded_attempts = 0 then null
        else tr.correct_answers::numeric / tr.graded_attempts::numeric
      end as accuracy,
      row_number() over (
        partition by tr.catalog_id
        order by
          case
            when tr.graded_attempts = 0 then 2::numeric
            else tr.correct_answers::numeric / tr.graded_attempts::numeric
          end asc,
          tr.graded_attempts desc,
          tr.topic_name
      ) as rank
    from topic_raw tr
    where tr.graded_attempts > 0
  ),
  weak as (
    select
      catalog_id,
      jsonb_agg(
        jsonb_build_object(
          'topic_id', topic_id,
          'topic_name', topic_name,
          'attempts', graded_attempts,
          'accuracy', accuracy
        )
        order by rank
      ) filter (where rank <= 3) as weak_topics
    from topic_ranked
    group by catalog_id
  )
  select
    c.id,
    c.name,
    coalesce(ct.content_items, 0)::bigint,
    coalesce(ct.question_items, 0)::bigint,
    coalesce(ct.vocabulary_items, 0)::bigint,
    coalesce(ct.reading_items, 0)::bigint,
    coalesce(ct.listening_items, 0)::bigint,
    coalesce(es.students_practiced, 0)::bigint,
    coalesce(es.sessions, 0)::bigint,
    coalesce(es.answer_attempts, 0)::bigint,
    es.avg_accuracy,
    es.avg_time_ms,
    es.last_activity,
    coalesce(w.weak_topics, '[]'::jsonb)
  from public.catalogs c
  left join content ct on ct.catalog_id = c.id
  left join event_stats es on es.catalog_id = c.id
  left join weak w on w.catalog_id = c.id
  where c.deleted_at is null
  order by
    coalesce(es.last_activity, '-infinity'::timestamptz) desc,
    es.sessions desc,
    c.name
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

revoke all on function public.teacher_catalog_analytics(integer)
  from public, anon, authenticated;
grant execute on function public.teacher_catalog_analytics(integer)
  to service_role;
