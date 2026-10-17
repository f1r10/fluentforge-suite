create or replace function public.student_streak_stats(
  p_student_id uuid
)
returns table(
  current_streak integer,
  longest_streak integer,
  last_active_day date
)
language sql
stable
security definer
set search_path = public
as $$
  with active_days as (
    select distinct
      (ae.created_at at time zone 'UTC')::date as active_day
    from public.activity_events ae
    where ae.student_id = p_student_id
      and ae.event_type <> 'exam_attempt_reset'
  ),
  numbered as (
    select
      active_day,
      active_day
        - row_number() over (order by active_day)::integer as streak_group
    from active_days
  ),
  streaks as (
    select
      min(active_day) as first_day,
      max(active_day) as last_day,
      count(*)::integer as streak_length
    from numbered
    group by streak_group
  ),
  summary as (
    select
      max(active_day) as latest_day
    from active_days
  )
  select
    case
      when summary.latest_day is null then 0
      when summary.latest_day
        < (now() at time zone 'UTC')::date - 1 then 0
      else coalesce(
        (
          select streak_length
          from streaks
          where last_day = summary.latest_day
          limit 1
        ),
        0
      )
    end::integer as current_streak,
    coalesce((select max(streak_length) from streaks), 0)::integer
      as longest_streak,
    summary.latest_day as last_active_day
  from summary;
$$;

revoke all on function public.student_streak_stats(uuid)
  from public, anon, authenticated;
grant execute on function public.student_streak_stats(uuid)
  to service_role;
