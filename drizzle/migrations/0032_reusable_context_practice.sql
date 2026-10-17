-- Allow teacher-approved contextual questions to participate in standalone
-- student practice while keeping ordinary reading/listening questions bound
-- to their parent context.

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
    and (
      q.context_kind = 'none'
      or q.reusable_independently = true
    )
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
          select 1
          from answered a
          where a.question_id = q.id
        )
      )
    )
    and (
      not p_exclude_answered
      or not exists (
        select 1
        from answered a
        where a.question_id = q.id
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
