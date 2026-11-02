-- A student whose teacher workspace is archived must not keep reading
-- the old classroom through an already minted access token. All existing
-- student RLS policies call public.current_student_id().
create or replace function public.current_student_id() returns uuid
language sql stable security definer
set search_path=public,pg_temp as $guard$
  select s.id
  from public.students s
  join public.student_sessions ss on ss.student_id = s.id
  join public.tenant_workspaces w on w.id = s.workspace_id
  where s.auth_user_id = auth.uid()
    and s.status = 'active' and s.deleted_at is null
    and w.status = 'active'
    and ss.revoked_at is null
    and ss.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  limit 1
$guard$;
