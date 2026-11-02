-- Tenant safety boundary on all workspace-owned tables.
-- RESTRICTIVE is essential: legacy permissive teacher policies alone would
-- allow teacher A to see tenant B. Even future permissive policies cannot
-- override this boundary. Existing teacher/student permissions remain in force.
create or replace function public.current_workspace_id()
returns uuid language sql stable security definer
set search_path = public, pg_temp as $workspace$
  select w.id
  from public.tenant_workspaces w
  where w.status='active' and (
    exists (
      select 1 from public.tenant_teacher_memberships m
      join public.user_roles r on r.user_id=m.teacher_auth_user_id
      where m.workspace_id=w.id
        and m.teacher_auth_user_id=auth.uid()
        and r.role='teacher'
    )
    or exists (
      select 1 from public.students s
      where s.workspace_id=w.id
        and s.id=public.current_student_id()
    )
  )
  limit 1
$workspace$;

revoke all on function public.current_workspace_id() from public,anon;
grant execute on function public.current_workspace_id() to authenticated,service_role;

do $guard$
declare rec record;
begin
  for rec in
    select c.table_name from information_schema.columns c
    join pg_class t on t.relname=c.table_name
    join pg_namespace n on n.oid=t.relnamespace and n.nspname='public'
    where c.table_schema='public' and c.column_name='workspace_id'
      and t.relkind in ('r','p')
  loop
    -- An ordinary teacher/student cannot see/write someone else's workspace
    -- even when an older permissive policy says public.is_teacher().
    execute format(
      'drop policy if exists %I on public.%I',
      'workspace_boundary_restrictive',rec.table_name
    );
    execute format(
      'create policy workspace_boundary_restrictive on public.%I as restrictive for all to authenticated using (workspace_id=public.current_workspace_id()) with check (workspace_id=public.current_workspace_id())',
      rec.table_name
    );
  end loop;
end
$guard$;

notify pgrst,'reload schema';
