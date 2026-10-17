-- Self-practice selection and student practice analytics.
-- These functions are service-role only because they accept a student id.

create or replace function public.select_self_practice_question_ids(
  p_student_id uuid,
  p_count integer,
  p_language text default null,
  p_level text default null,
  p_types text[] default null,
  p_topic_ids uuid[] default null,
  p_catalog_id uuid default null,
  p_source_file_id uuid default null,
  p_history_mode text default 'all',
  p_exclude_answered boolean default false
)
returns table(question_id uuid)
language sql
volatile
set search_path = public
as $$
  with answered as (
    select distinct ae.entity_id as question_id
    from public.activity_events ae
    where ae.student_id = p_student_id
      and ae.category = 'practice'
      and ae.event_type = 'practice_answer'
      and ae.entity_type = 'question'
      and ae.entity_id is not null
  ),
  latest as (
    select distinct on (ae.entity_id)
      ae.entity_id as question_id,
      ae.is_correct,
      ae.created_at
    from public.activity_events ae
    where ae.student_id = p_student_id
      and ae.category = 'practice'
      and ae.event_type = 'practice_answer'
      and ae.entity_type = 'question'
      and ae.entity_id is not null
    order by ae.entity_id, ae.created_at desc, ae.id desc
  )
  select q.id
  from public.questions q
  where q.deleted_at is null
    and q.status = 'active'
    -- Contextual reading/listening questions are intentionally excluded from
    -- generated random self-practice. They are practiced with their parent.
    and q.context_kind = 'none'
    and (p_language is null or q.learning_language = p_language)
    and (p_level is null or q.level = p_level)
    and (
      p_types is null
      or cardinality(p_types) = 0
      or q.question_type = any(p_types)
    )
    and (
      p_topic_ids is null
      or cardinality(p_topic_ids) = 0
      or exists (
        select 1
        from public.question_topics qt
        where qt.question_id = q.id
          and qt.topic_id = any(p_topic_ids)
      )
    )
    and (
      p_catalog_id is null
      or exists (
        select 1
        from public.catalog_items ci
        where ci.catalog_id = p_catalog_id
          and ci.entity_type = 'question'
          and ci.entity_id = q.id
      )
    )
    and (
      p_source_file_id is null
      or q.source_file_id = p_source_file_id
      or exists (
        select 1
        from public.source_collection_items sci
        where sci.source_file_id = p_source_file_id
          and sci.entity_type = 'question'
          and sci.entity_id = q.id
      )
    )
    and (
      p_history_mode = 'all'
      or (
        p_history_mode = 'mistakes'
        and exists (
          select 1
          from latest l
          where l.question_id = q.id
            and l.is_correct = false
        )
      )
      or (
        p_history_mode = 'unused'
        and not exists (
          select 1 from answered a where a.question_id = q.id
        )
      )
    )
    and (
      not p_exclude_answered
      or not exists (
        select 1 from answered a where a.question_id = q.id
      )
    )
  order by random()
  limit greatest(1, least(coalesce(p_count, 10), 100));
$$;

revoke all on function public.select_self_practice_question_ids(
  uuid, integer, text, text, text[], uuid[], uuid, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.select_self_practice_question_ids(
  uuid, integer, text, text, text[], uuid[], uuid, uuid, text, boolean
) to service_role;

create or replace function public.student_practice_stats(p_student_id uuid)
returns table(
  total_answers bigint,
  correct_answers bigint,
  wrong_answers bigint,
  manual_answers bigint,
  questions_seen bigint,
  total_time_ms bigint,
  today_answers bigint,
  week_answers bigint,
  current_mistakes bigint
)
language sql
stable
set search_path = public
as $$
  with answers as (
    select *
    from public.activity_events ae
    where ae.student_id = p_student_id
      and ae.category = 'practice'
      and ae.event_type = 'practice_answer'
      and ae.entity_type = 'question'
      and ae.entity_id is not null
  ),
  latest as (
    select distinct on (entity_id)
      entity_id,
      is_correct
    from answers
    order by entity_id, created_at desc, id desc
  )
  select
    count(*)::bigint as total_answers,
    count(*) filter (where is_correct = true)::bigint as correct_answers,
    count(*) filter (where is_correct = false)::bigint as wrong_answers,
    count(*) filter (where is_correct is null)::bigint as manual_answers,
    count(distinct entity_id)::bigint as questions_seen,
    coalesce(sum(duration_ms), 0)::bigint as total_time_ms,
    count(*) filter (where created_at >= date_trunc('day', now()))::bigint as today_answers,
    count(*) filter (where created_at >= now() - interval '7 days')::bigint as week_answers,
    (
      select count(*)::bigint
      from latest
      where is_correct = false
    ) as current_mistakes
  from answers;
$$;

revoke all on function public.student_practice_stats(uuid) from public, anon, authenticated;
grant execute on function public.student_practice_stats(uuid) to service_role;

create or replace function public.student_topic_practice_stats(
  p_student_id uuid,
  p_limit integer default 12
)
returns table(
  topic_id uuid,
  topic_name text,
  attempts bigint,
  correct bigint,
  accuracy numeric
)
language sql
stable
set search_path = public
as $$
  select
    t.id as topic_id,
    t.name as topic_name,
    count(*)::bigint as attempts,
    count(*) filter (where ae.is_correct = true)::bigint as correct,
    case
      when count(*) filter (where ae.is_correct is not null) = 0 then null
      else
        count(*) filter (where ae.is_correct = true)::numeric
        / count(*) filter (where ae.is_correct is not null)::numeric
    end as accuracy
  from public.activity_events ae
  join public.question_topics qt on qt.question_id = ae.entity_id
  join public.topics t on t.id = qt.topic_id
  where ae.student_id = p_student_id
    and ae.category = 'practice'
    and ae.event_type = 'practice_answer'
    and ae.entity_type = 'question'
  group by t.id, t.name
  order by attempts desc, t.name
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

revoke all on function public.student_topic_practice_stats(uuid, integer) from public, anon, authenticated;
grant execute on function public.student_topic_practice_stats(uuid, integer) to service_role;

create or replace function public.student_practice_daily_stats(
  p_student_id uuid,
  p_days integer default 14
)
returns table(
  day date,
  attempts bigint,
  correct bigint
)
language sql
stable
set search_path = public
as $$
  with days as (
    select generate_series(
      current_date - (greatest(1, least(coalesce(p_days, 14), 90)) - 1),
      current_date,
      interval '1 day'
    )::date as day
  ),
  answers as (
    select
      created_at::date as day,
      count(*)::bigint as attempts,
      count(*) filter (where is_correct = true)::bigint as correct
    from public.activity_events
    where student_id = p_student_id
      and category = 'practice'
      and event_type = 'practice_answer'
      and entity_type = 'question'
      and created_at >= current_date - (greatest(1, least(coalesce(p_days, 14), 90)) - 1)
    group by created_at::date
  )
  select
    d.day,
    coalesce(a.attempts, 0)::bigint,
    coalesce(a.correct, 0)::bigint
  from days d
  left join answers a using(day)
  order by d.day;
$$;

revoke all on function public.student_practice_daily_stats(uuid, integer) from public, anon, authenticated;
grant execute on function public.student_practice_daily_stats(uuid, integer) to service_role;

create index if not exists activity_events_student_practice_question_idx
  on public.activity_events(student_id, entity_id, created_at desc)
  where category = 'practice'
    and event_type = 'practice_answer'
    and entity_type = 'question';
