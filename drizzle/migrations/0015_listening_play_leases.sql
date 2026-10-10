-- Server-authoritative listening playback leases for exam attempts.

create table if not exists public.exam_listening_plays (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  listening_id uuid not null,
  request_id uuid not null,
  play_number integer not null check (play_number > 0),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  completed_at timestamptz,
  unique (attempt_id, listening_id, request_id),
  unique (attempt_id, listening_id, play_number)
);

create index if not exists exam_listening_plays_attempt_idx
  on public.exam_listening_plays(attempt_id, listening_id, play_number);

alter table public.exam_listening_plays enable row level security;

drop policy if exists "teacher full access" on public.exam_listening_plays;
create policy "teacher full access" on public.exam_listening_plays
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());

grant select, insert, update, delete on public.exam_listening_plays
  to authenticated;
grant all on public.exam_listening_plays to service_role;

create or replace function public.claim_exam_listening_play(
  p_attempt_id uuid,
  p_student_id uuid,
  p_listening_id uuid,
  p_request_id uuid,
  p_max_plays integer,
  p_lease_seconds integer
)
returns table (
  id uuid,
  play_number integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_status public.attempt_status;
  attempt_deadline timestamptz;
  used_count integer;
  existing public.exam_listening_plays;
  created public.exam_listening_plays;
  lease_seconds integer;
begin
  select ea.status, ea.deadline_at
  into attempt_status, attempt_deadline
  from public.exam_attempts ea
  where ea.id = p_attempt_id
    and ea.student_id = p_student_id
  for update;

  if not found then
    raise exception 'ATTEMPT_NOT_FOUND';
  end if;

  if attempt_status <> 'in_progress' then
    raise exception 'ATTEMPT_NOT_ACTIVE';
  end if;

  if attempt_deadline is not null and now() >= attempt_deadline then
    raise exception 'ATTEMPT_DEADLINE_EXPIRED';
  end if;

  select *
  into existing
  from public.exam_listening_plays lp
  where lp.attempt_id = p_attempt_id
    and lp.listening_id = p_listening_id
    and lp.request_id = p_request_id
  limit 1;

  if found then
    return query
      select existing.id, existing.play_number, existing.expires_at;
    return;
  end if;

  select count(*)::integer
  into used_count
  from public.exam_listening_plays lp
  where lp.attempt_id = p_attempt_id
    and lp.listening_id = p_listening_id;

  if p_max_plays is not null
     and used_count >= greatest(p_max_plays, 0) then
    raise exception 'PLAY_LIMIT_REACHED';
  end if;

  lease_seconds := greatest(
    60,
    least(coalesce(p_lease_seconds, 1800), 14400)
  );

  insert into public.exam_listening_plays(
    attempt_id,
    student_id,
    listening_id,
    request_id,
    play_number,
    expires_at
  )
  values (
    p_attempt_id,
    p_student_id,
    p_listening_id,
    p_request_id,
    used_count + 1,
    now() + make_interval(secs => lease_seconds)
  )
  returning * into created;

  return query
    select created.id, created.play_number, created.expires_at;
end;
$$;

revoke all on function public.claim_exam_listening_play(
  uuid, uuid, uuid, uuid, integer, integer
) from public, anon, authenticated;

grant execute on function public.claim_exam_listening_play(
  uuid, uuid, uuid, uuid, integer, integer
) to service_role;
