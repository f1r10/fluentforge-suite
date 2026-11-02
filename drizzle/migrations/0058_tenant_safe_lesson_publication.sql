-- Publish from the authenticated teacher server function without exposing a
-- cross-workspace or student-triggerable revision transition. Existing V1
-- service-role publication remains available for authorized legacy callers.
create or replace function public.publish_lesson_revision(
  p_catalog_id uuid, p_draft_id uuid
) returns uuid
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  draft_row public.lesson_revisions%rowtype;
  _service boolean := coalesce(
    current_setting('role', true) = 'service_role'
    and current_setting('request.jwt.claim.role', true) = 'service_role',
    false
  );
  _workspace uuid;
begin
  if not _service then
    if not public.is_teacher() then
      raise exception 'Teacher authorization required' using errcode='42501';
    end if;
    _workspace := public.current_workspace_id();
    if _workspace is null then
      raise exception 'Active teacher workspace required' using errcode='42501';
    end if;
  end if;

  select * into draft_row from public.lesson_revisions
    where id=p_draft_id and catalog_id=p_catalog_id and state='draft'
      and (_service or workspace_id=_workspace)
    for update;
  if not found then
    raise exception 'Lesson draft not found or already published';
  end if;

  perform 1 from public.catalogs
    where id=p_catalog_id and status='active' and deleted_at is null
      and (_service or workspace_id=_workspace);
  if not found then raise exception 'Catalog is not active'; end if;

  perform set_config('fluentforge.lesson_publish','true',true);
  update public.lesson_revisions
    set state='superseded'
    where catalog_id=p_catalog_id and state='published'
      and (_service or workspace_id=_workspace);
  update public.lesson_revisions
    set state='published',published_at=now()
    where id=p_draft_id and (_service or workspace_id=_workspace);
  return p_draft_id;
end;
$$;

revoke all on function public.publish_lesson_revision(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.publish_lesson_revision(uuid,uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
