create or replace function public.student_domain_progress(
  p_student_id uuid
)
returns table(
  domain text,
  attempts bigint,
  correct bigint,
  incorrect bigint,
  accuracy numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with domains(domain) as (
    values
      ('grammar'::text),
      ('vocabulary'::text),
      ('reading'::text),
      ('listening'::text)
  ),
  question_events as (
    select
      case
        when q.context_kind = 'reading' then 'reading'::text
        when q.context_kind = 'listening'
          or q.question_type in ('dictation', 'listening_transcription')
          then 'listening'::text
        else 'grammar'::text
      end as domain,
      ae.is_correct
    from public.activity_events ae
    join public.questions q
      on q.id = ae.entity_id
    where ae.student_id = p_student_id
      and ae.category = 'practice'
      and ae.event_type = 'practice_answer'
      and ae.entity_type = 'question'
      and ae.entity_id is not null
  ),
  vocabulary_events as (
    select
      'vocabulary'::text as domain,
      ae.is_correct
    from public.activity_events ae
    where ae.student_id = p_student_id
      and ae.category = 'practice'
      and ae.entity_type = 'vocabulary'
      and ae.event_type in ('vocabulary_answer', 'vocabulary_rating')
  ),
  all_events as (
    select * from question_events
    union all
    select * from vocabulary_events
  ),
  stats as (
    select
      domain,
      count(*)::bigint as attempts,
      count(*) filter (where is_correct = true)::bigint as correct,
      count(*) filter (where is_correct = false)::bigint as incorrect,
      case
        when count(*) filter (where is_correct is not null) = 0 then null
        else
          count(*) filter (where is_correct = true)::numeric
          / count(*) filter (where is_correct is not null)::numeric
      end as accuracy
    from all_events
    group by domain
  )
  select
    d.domain,
    coalesce(s.attempts, 0)::bigint,
    coalesce(s.correct, 0)::bigint,
    coalesce(s.incorrect, 0)::bigint,
    s.accuracy
  from domains d
  left join stats s on s.domain = d.domain
  order by array_position(
    array['grammar','vocabulary','reading','listening']::text[],
    d.domain
  );
$$;

revoke all on function public.student_domain_progress(uuid)
  from public, anon, authenticated;
grant execute on function public.student_domain_progress(uuid)
  to service_role;

insert into public.system_settings(key, value, is_public)
values (
  'student_dashboard',
  '{"visible_widgets":["catalogs","exams","practice","today","correctness","accuracy","study_time","streak","progress","domain_progress","weak_topics","history","favorites","completed_exams"]}'::jsonb,
  false
)
on conflict (key) do update
set value = jsonb_build_object(
  'visible_widgets',
  (
    select jsonb_agg(value order by ord)
    from (
      select value, min(ord) as ord
      from (
        select value, ordinality as ord
        from jsonb_array_elements_text(
          coalesce(
            system_settings.value -> 'visible_widgets',
            system_settings.value -> 'widgets',
            '[]'::jsonb
          )
        ) with ordinality

        union all
        values
          ('correctness'::text, 1000001::bigint),
          ('completed_exams'::text, 1000002::bigint),
          ('domain_progress'::text, 1000003::bigint)
      ) merged
      group by value
    ) deduped
  )
);
