-- Bind each listening play lease to a high-entropy capability token.
-- Only the SHA-256 digest is stored; the raw token is returned once to the
-- authenticated student and expires with the lease.

alter table public.exam_listening_plays
  add column if not exists stream_token_hash text;

create unique index if not exists exam_listening_plays_token_hash_idx
  on public.exam_listening_plays(stream_token_hash)
  where stream_token_hash is not null;

drop function if exists public.claim_exam_listening_play(
  uuid, uuid, uuid, uuid, integer, integer
);

create or replace function public.claim_exam_listening_play(
  p_attempt_id uuid,
  p_student_id uuid,
  p_listening_id uuid,
  p_request_id uuid,
  p_max_plays integer,
  p_lease_seconds integer,
  p_stream_token_hash text
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
  if p_stream_token_hash is null
     or length(p_stream_token_hash) <> 64
     or p_stream_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'INVALID_STREAM_TOKEN_HASH';
  end if;

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
    -- Refresh the capability hash for an idempotent request retry. This lets
    -- the retried server call return a fresh raw token while preserving the
    -- original play_number instead of consuming another play.
    update public.exam_listening_plays
    set stream_token_hash = p_stream_token_hash
    where public.exam_listening_plays.id = existing.id
    returning * into existing;

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
    expires_at,
    stream_token_hash
  )
  values (
    p_attempt_id,
    p_student_id,
    p_listening_id,
    p_request_id,
    used_count + 1,
    now() + make_interval(secs => lease_seconds),
    p_stream_token_hash
  )
  returning * into created;

  return query
    select created.id, created.play_number, created.expires_at;
end;
$$;

revoke all on function public.claim_exam_listening_play(
  uuid, uuid, uuid, uuid, integer, integer, text
) from public, anon, authenticated;

grant execute on function public.claim_exam_listening_play(
  uuid, uuid, uuid, uuid, integer, integer, text
) to service_role;
