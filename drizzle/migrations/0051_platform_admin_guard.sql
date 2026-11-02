-- Keep initial platform administration single-account until multi-admin
-- lifecycle and audit requirements are explicitly implemented.
create unique index if not exists platform_admin_single_account_uidx
  on public.platform_admin_users((true));

-- Restrict teacher creation while the original broad teacher RLS policy
-- remains in the DB. The application must not make a second teacher until
-- all tenant-aware policies and service-role paths have been audited.
do $guard$
begin
  if exists (
    select 1 from pg_indexes
    where schemaname='public'
      and tablename='admin_users'
      and indexname='admin_users_single_teacher_uidx'
  ) then
    raise notice 'V1 single-teacher safety index intentionally retained';
  end if;
end;
$guard$;
