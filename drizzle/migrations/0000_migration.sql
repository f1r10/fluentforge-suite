
-- ===== Enums =====
create type public.app_role as enum ('teacher', 'student');
create type public.student_status as enum ('active', 'disabled', 'archived');
create type public.content_status as enum ('draft', 'active', 'archived');
create type public.exam_status as enum ('draft', 'scheduled', 'active', 'finished', 'archived');
create type public.job_status as enum ('queued', 'processing', 'needs_review', 'completed', 'failed');
create type public.media_kind as enum ('image', 'audio', 'video', 'document', 'other');
create type public.attempt_status as enum ('in_progress', 'submitted', 'auto_submitted', 'graded', 'abandoned');
create type public.review_status as enum ('pending', 'reviewed');
create type public.context_kind as enum ('none', 'reading', 'listening');

-- ===== Generic updated_at trigger =====
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

-- ===== Roles =====
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role public.app_role not null,
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;
create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'teacher')
$$;
create policy "own roles readable" on public.user_roles for select to authenticated using (user_id = auth.uid());

-- ===== Admin =====
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique,
  username text not null unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.admin_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_users(id) on delete cascade,
  code_hash text not null,
  set_id uuid not null,
  used_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.admin_recovery_codes(admin_id) where used_at is null and invalidated_at is null;

-- ===== Languages & settings =====
create table public.languages (
  code text primary key,
  name text not null,
  native_name text,
  is_interface boolean not null default false,
  is_learning boolean not null default false,
  is_translation boolean not null default false,
  sort_order int not null default 0
);
create table public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ===== Students & groups =====
create table public.students (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  first_name text not null,
  last_name text not null,
  username text not null unique,
  status public.student_status not null default 'active',
  interface_language text references public.languages(code),
  last_active_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.students(status);
create index on public.students(lower(last_name), lower(first_name));
create table public.student_access_keys (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  key_hash text not null unique,
  key_hint text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index on public.student_access_keys(student_id) where revoked_at is null;
create table public.student_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  auth_session_id uuid not null unique,
  user_agent text,
  ip text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_location text,
  revoked_at timestamptz
);
create index on public.student_sessions(student_id) where revoked_at is null;
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.group_memberships (
  group_id uuid not null references public.groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (group_id, student_id)
);
create index on public.group_memberships(student_id);

create or replace function public.current_student_id() returns uuid
language sql stable security definer set search_path = public as $$
  select s.id from public.students s
  join public.student_sessions ss on ss.student_id = s.id
  where s.auth_user_id = auth.uid()
    and s.status = 'active' and s.deleted_at is null
    and ss.revoked_at is null
    and ss.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  limit 1
$$;

-- ===== Taxonomy =====
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.topics(id) on delete set null,
  name text not null,
  learning_language text references public.languages(code),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.topics(parent_id);
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- ===== Sources & imports =====
create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  storage_path text,
  keep_original boolean not null default false,
  original_deleted_at timestamptz,
  page_count int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.import_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'document',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  source_file_id uuid references public.source_files(id) on delete set null,
  profile_id uuid references public.import_profiles(id) on delete set null,
  status public.job_status not null default 'queued',
  mode text not null default 'review',
  progress int not null default 0,
  extraction_method text,
  error text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.import_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.import_jobs(id) on delete cascade,
  item_type text not null,
  page int,
  sheet text,
  crop jsonb,
  payload jsonb not null default '{}'::jsonb,
  confidence numeric,
  decision text not null default 'pending',
  duplicate_of uuid,
  duplicate_kind text,
  created_entity_id uuid,
  created_at timestamptz not null default now()
);
create index on public.import_items(job_id, decision);

-- ===== Media =====
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  kind public.media_kind not null,
  storage_path text,
  external_url text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  duration_seconds numeric,
  width int, height int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index on public.media_assets(checksum) where checksum is not null and deleted_at is null;

-- ===== Readings & listenings =====
create table public.readings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  learning_language text references public.languages(code),
  level text,
  word_count int,
  display_layout text not null default 'stacked',
  status public.content_status not null default 'active',
  source_file_id uuid references public.source_files(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.reading_media (
  reading_id uuid references public.readings(id) on delete cascade,
  media_id uuid references public.media_assets(id) on delete cascade,
  sort_order int not null default 0,
  primary key (reading_id, media_id)
);
create table public.reading_question_sets (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null references public.readings(id) on delete cascade,
  title text,
  instructions text,
  sort_order int not null default 0
);
create table public.listenings (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  media_id uuid references public.media_assets(id) on delete set null,
  transcript text,
  transcript_segments jsonb,
  transcript_source text,
  learning_language text references public.languages(code),
  level text,
  playback_rules jsonb not null default '{}'::jsonb,
  status public.content_status not null default 'active',
  source_file_id uuid references public.source_files(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.listening_sections (
  id uuid primary key default gen_random_uuid(),
  listening_id uuid not null references public.listenings(id) on delete cascade,
  title text,
  start_seconds numeric,
  end_seconds numeric,
  sort_order int not null default 0
);
create table public.listening_question_sets (
  id uuid primary key default gen_random_uuid(),
  listening_id uuid not null references public.listenings(id) on delete cascade,
  section_id uuid references public.listening_sections(id) on delete set null,
  title text,
  instructions text,
  sort_order int not null default 0
);

-- ===== Questions =====
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  question_type text not null,
  prompt text not null default '',
  instructions text,
  payload jsonb not null default '{}'::jsonb,
  answer_key jsonb not null default '{}'::jsonb,
  scoring jsonb not null default '{"points":1}'::jsonb,
  normalization jsonb not null default '{}'::jsonb,
  explanation text,
  teacher_notes text,
  learning_language text references public.languages(code),
  level text,
  difficulty smallint,
  media_id uuid references public.media_assets(id) on delete set null,
  context_kind public.context_kind not null default 'none',
  reading_question_set_id uuid references public.reading_question_sets(id) on delete set null,
  listening_question_set_id uuid references public.listening_question_sets(id) on delete set null,
  context_sort int not null default 0,
  reusable_independently boolean not null default false,
  grading_mode text not null default 'automatic',
  source_file_id uuid references public.source_files(id) on delete set null,
  source_page int,
  source_sheet text,
  import_job_id uuid references public.import_jobs(id) on delete set null,
  provenance jsonb not null default '{}'::jsonb,
  content_hash text,
  status public.content_status not null default 'active',
  current_version int not null default 1,
  search tsvector generated always as (to_tsvector('simple', coalesce(prompt,'') || ' ' || coalesce(instructions,''))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.questions using gin(search);
create index on public.questions(question_type);
create index on public.questions(learning_language, level);
create index on public.questions(content_hash);
create index on public.questions(created_at desc);
create table public.question_versions (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique (question_id, version)
);
create table public.question_topics (
  question_id uuid references public.questions(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete cascade,
  primary key (question_id, topic_id)
);
create index on public.question_topics(topic_id);
create table public.question_tags (
  question_id uuid references public.questions(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  primary key (question_id, tag_id)
);
create table public.source_collection_items (
  source_file_id uuid references public.source_files(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  primary key (source_file_id, entity_type, entity_id)
);

-- ===== Vocabulary =====
create table public.vocabulary_entries (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  learning_language text references public.languages(code),
  definition text,
  ipa text,
  part_of_speech text,
  audio_media_id uuid references public.media_assets(id) on delete set null,
  synonyms text[] not null default '{}',
  antonyms text[] not null default '{}',
  level text,
  notes text,
  source_file_id uuid references public.source_files(id) on delete set null,
  provenance jsonb not null default '{}'::jsonb,
  status public.content_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on public.vocabulary_entries(lower(word));
create table public.vocabulary_translations (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.vocabulary_entries(id) on delete cascade,
  language text not null references public.languages(code),
  value text not null
);
create index on public.vocabulary_translations(entry_id);
create table public.vocabulary_examples (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.vocabulary_entries(id) on delete cascade,
  sentence text not null,
  translation text,
  sort_order int not null default 0
);
create table public.vocabulary_topics (
  entry_id uuid references public.vocabulary_entries(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete cascade,
  primary key (entry_id, topic_id)
);
create table public.vocabulary_tags (
  entry_id uuid references public.vocabulary_entries(id) on delete cascade,
  tag_id uuid references public.tags(id) on delete cascade,
  primary key (entry_id, tag_id)
);
create table public.vocabulary_learner_states (
  student_id uuid references public.students(id) on delete cascade,
  entry_id uuid references public.vocabulary_entries(id) on delete cascade,
  state text not null,
  updated_at timestamptz not null default now(),
  primary key (student_id, entry_id)
);

-- ===== Catalogs =====
create table public.catalogs (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.catalogs(id) on delete set null,
  name text not null,
  description text,
  settings jsonb not null default '{}'::jsonb,
  status public.content_status not null default 'active',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (catalog_id, entity_type, entity_id)
);
create index on public.catalog_items(entity_type, entity_id);
create table public.catalog_assignments (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.catalogs(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ===== Exams =====
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status public.exam_status not null default 'draft',
  available_from timestamptz,
  available_until timestamptz,
  duration_minutes int,
  settings jsonb not null default '{}'::jsonb,
  published_snapshot jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.exam_sections (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  title text,
  instructions text,
  sort_order int not null default 0,
  pool_rules jsonb
);
create table public.exam_items (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  section_id uuid references public.exam_sections(id) on delete cascade,
  entity_type text not null,
  entity_id uuid,
  question_version int,
  points numeric,
  sort_order int not null default 0
);
create table public.exam_assignments (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  group_id uuid references public.groups(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id),
  student_id uuid not null references public.students(id),
  attempt_number int not null default 1,
  status public.attempt_status not null default 'in_progress',
  snapshot jsonb not null,
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  submitted_at timestamptz,
  score numeric, max_score numeric,
  passed boolean,
  result_released boolean not null default false,
  violations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.exam_attempts(exam_id, student_id);
create table public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.exam_attempts(id) on delete cascade,
  item_key text not null,
  question_id uuid,
  question_version int,
  response jsonb,
  is_correct boolean,
  score numeric,
  auto_score numeric,
  flagged boolean not null default false,
  change_count int not null default 0,
  time_spent_ms int not null default 0,
  updated_at timestamptz not null default now(),
  unique (attempt_id, item_key)
);
create table public.manual_reviews (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid references public.attempt_answers(id) on delete cascade,
  student_id uuid references public.students(id) on delete cascade,
  question_id uuid,
  status public.review_status not null default 'pending',
  ai_suggestion jsonb,
  final_score numeric,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.teacher_feedback (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid references public.exam_attempts(id) on delete cascade,
  answer_id uuid references public.attempt_answers(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create table public.student_notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ===== Activity, reports, favorites, notifications =====
create table public.activity_events (
  id bigint generated always as identity primary key,
  student_id uuid references public.students(id) on delete cascade,
  category text not null default 'activity',
  event_type text not null,
  entity_type text, entity_id uuid,
  attempt_id uuid,
  is_correct boolean,
  response jsonb,
  duration_ms int,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.activity_events(student_id, created_at desc);
create index on public.activity_events(entity_type, entity_id);
create table public.question_reports (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  comment text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.favorites (
  student_id uuid references public.students(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (student_id, entity_type, entity_id)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null,
  student_id uuid references public.students(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  data jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.notifications(recipient_type, student_id, read_at);

-- ===== Jobs & audit =====
create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null, format text not null,
  params jsonb not null default '{}'::jsonb,
  status public.job_status not null default 'queued',
  storage_path text, error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.backups (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'manual',
  status public.job_status not null default 'queued',
  storage_path text, size_bytes bigint, error text,
  created_at timestamptz not null default now()
);
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_type text not null,
  actor_id uuid,
  action text not null,
  entity_type text, entity_id text,
  summary text,
  details jsonb not null default '{}'::jsonb,
  ip text,
  created_at timestamptz not null default now()
);
create index on public.audit_logs(created_at desc);
create table public.login_attempts (
  id bigint generated always as identity primary key,
  kind text not null,
  identifier text not null,
  ip text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index on public.login_attempts(identifier, created_at desc);
create index on public.login_attempts(ip, created_at desc);

-- ===== Grants, RLS, teacher-all policies =====
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname='public' and tablename <> 'user_roles' loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "teacher full access" on public.%I for all to authenticated using (public.is_teacher()) with check (public.is_teacher())', t);
  end loop;
end $$;
grant usage on all sequences in schema public to authenticated, service_role;

-- updated_at triggers
do $$
declare t text;
begin
  for t in select table_name from information_schema.columns where table_schema='public' and column_name='updated_at' loop
    execute format('create trigger trg_touch before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end $$;

-- Public read of branding/languages (login screen)
grant select on public.system_settings, public.languages to anon;
create policy "public settings readable" on public.system_settings for select to anon, authenticated using (is_public);
create policy "languages readable" on public.languages for select to anon, authenticated using (true);

-- Student policies
create policy "student reads self" on public.students for select to authenticated using (id = public.current_student_id());
create policy "student reads own memberships" on public.group_memberships for select to authenticated using (student_id = public.current_student_id());
create policy "student reads own groups" on public.groups for select to authenticated using (exists (select 1 from public.group_memberships m where m.group_id = groups.id and m.student_id = public.current_student_id()));
create policy "student own notifications" on public.notifications for select to authenticated using (recipient_type='student' and student_id = public.current_student_id());
create policy "student mark notifications" on public.notifications for update to authenticated using (recipient_type='student' and student_id = public.current_student_id()) with check (student_id = public.current_student_id());
create policy "student own favorites" on public.favorites for all to authenticated using (student_id = public.current_student_id()) with check (student_id = public.current_student_id());
create policy "student insert activity" on public.activity_events for insert to authenticated with check (student_id = public.current_student_id());
create policy "student read activity" on public.activity_events for select to authenticated using (student_id = public.current_student_id());
create policy "student report question" on public.question_reports for insert to authenticated with check (student_id = public.current_student_id());
create policy "student vocab states" on public.vocabulary_learner_states for all to authenticated using (student_id = public.current_student_id()) with check (student_id = public.current_student_id());
create policy "student reads feedback" on public.teacher_feedback for select to authenticated using (student_id = public.current_student_id());

-- ===== Seed minimal data =====
insert into public.languages(code, name, native_name, is_interface, is_learning, is_translation, sort_order) values
 ('az','Azerbaijani','Azərbaycanca', true, false, true, 1),
 ('en','English','English', true, true, false, 2),
 ('ru','Russian','Русский', true, false, true, 3),
 ('tr','Turkish','Türkçe', true, false, true, 4);

insert into public.system_settings(key, value, is_public) values
 ('branding', '{"system_name":"Learning Platform","short_name":"Learning","login_title":"Welcome","welcome_message":"","login_instructions":"","footer":"","support_text":"","accent_color":"#1f5fbf","logo_url":null,"favicon_url":null,"login_image_url":null}', true),
 ('interface', '{"default_language":"az"}', true),
 ('student_dashboard', '{"widgets":["today","accuracy","study_time","exams","progress","weak_topics","history","favorites"]}', false),
 ('teacher_dashboard', '{"widgets":["online","inbox","recent_activity","students","content"]}', false),
 ('practice_defaults', '{"feedback":"instant","shuffle":true}', false),
 ('exam_defaults', '{"full_duration_after_start":true,"autosubmit":true,"shuffle_questions":false,"shuffle_options":false}', false),
 ('ai', '{"provider":"none"}', false),
 ('ocr', '{"provider":"none"}', false),
 ('media', '{"max_video_mb":700}', false),
 ('retention', '{"trash_days":30,"activity":"permanent"}', false);
