-- Structural tenancy preparation ONLY. This migration does not allow a
-- second teacher: the V1 single-teacher constraint remains and all existing
-- broad RLS policies must be replaced before a multi-teacher launch.
create table if not exists public.tenant_workspaces (
  id uuid primary key,
  name text not null,
  status text not null default 'active'
    check (status in ('active','disabled','archived')),
  created_at timestamptz not null default now()
);
create table if not exists public.tenant_teacher_memberships (
  teacher_auth_user_id uuid primary key,
  workspace_id uuid not null references public.tenant_workspaces(id),
  created_at timestamptz not null default now()
);
create index if not exists tenant_teacher_membership_workspace_idx
  on public.tenant_teacher_memberships(workspace_id);
create table if not exists public.platform_admin_users (
  auth_user_id uuid primary key,
  username text not null unique,
  created_at timestamptz not null default now(),
  disabled_at timestamptz
);

-- Deterministic workspace ID preserves V1 data while avoiding any new login
-- or role exposure. A future migration must replace defaults with principals
-- before allowing teacher #2.
insert into public.tenant_workspaces(id,name)
values ('00000000-0000-4000-8000-000000000001', 'Legacy teacher workspace')
on conflict (id) do nothing;
insert into public.tenant_teacher_memberships(teacher_auth_user_id,workspace_id)
select auth_user_id, '00000000-0000-4000-8000-000000000001'::uuid
from public.admin_users
on conflict (teacher_auth_user_id) do nothing;

-- On fresh installations the original first-run teacher can still be created
-- after the tenant schema is installed.
create or replace function public.link_first_teacher_to_legacy_workspace()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $tag$
begin
  if not exists(select 1 from public.tenant_teacher_memberships) then
    insert into public.tenant_teacher_memberships(teacher_auth_user_id,workspace_id)
    values (new.auth_user_id,'00000000-0000-4000-8000-000000000001'::uuid);
  end if;
  return new;
end;
$tag$;
drop trigger if exists legacy_teacher_workspace_trigger on public.admin_users;
create trigger legacy_teacher_workspace_trigger after insert on public.admin_users
for each row execute function public.link_first_teacher_to_legacy_workspace();

-- Every V1 private record is assigned to the original workspace. Leave all
-- existing table IDs and relationships unchanged. New data created by V1
-- continues to belong to the same workspace.
do $tag$
declare t text;
begin
  foreach t in array array[
    'students','student_access_keys','student_sessions','groups',
    'group_memberships','topics','tags','source_files','import_profiles',
    'import_jobs','import_items','media_assets','readings','reading_media',
    'reading_question_sets','listenings','listening_sections',
    'listening_question_sets','questions','question_versions','question_topics',
    'question_tags','source_collection_items','vocabulary_entries',
    'vocabulary_translations','vocabulary_examples','vocabulary_topics',
    'vocabulary_tags','vocabulary_learner_states','catalogs','catalog_items',
    'catalog_assignments','exams','exam_sections','exam_items',
    'exam_assignments','exam_attempts','attempt_answers','manual_reviews',
    'teacher_feedback','student_notes','activity_events','question_reports',
    'favorites','notifications','export_jobs','backups','audit_logs',
    'lesson_revisions','lesson_step_progress','library_categories',
    'library_books','student_personal_vocabulary','student_review_schedules',
    'listening_dictation_attempts','backup_event_restore_batches',
    'scheduled_backups'
  ]
  loop
    if to_regclass(format('public.%I',t)) is not null then
      execute format('alter table public.%I add column if not exists workspace_id uuid',t);
      execute format('update public.%I set workspace_id = %L::uuid where workspace_id is null',
        t,'00000000-0000-4000-8000-000000000001');
      execute format('alter table public.%I alter column workspace_id set default %L::uuid',
        t,'00000000-0000-4000-8000-000000000001');
      execute format('alter table public.%I alter column workspace_id set not null',t);
      if not exists(
        select 1 from pg_constraint
        where conrelid = format('public.%I',t)::regclass
        and conname = t || '_workspace_fk'
      ) then
        execute format('alter table public.%I add constraint %I foreign key(workspace_id) references public.tenant_workspaces(id)',
          t,t || '_workspace_fk');
      end if;
    end if;
  end loop;
end;
$tag$;

alter table public.tenant_workspaces enable row level security;
alter table public.tenant_teacher_memberships enable row level security;
alter table public.platform_admin_users enable row level security;
revoke all on public.tenant_workspaces,public.tenant_teacher_memberships,
  public.platform_admin_users from anon,authenticated;
grant all on public.tenant_workspaces,public.tenant_teacher_memberships,
  public.platform_admin_users to service_role;
