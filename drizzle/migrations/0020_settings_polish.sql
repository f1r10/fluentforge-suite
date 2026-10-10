insert into public.system_settings(key, value, is_public)
values
  (
    'dashboard',
    '{"visible_widgets":["students","active_today","groups","catalogs","exams","pending_reviews","online_now","recent_activity","upcoming_exams","recent_catalogs"]}'::jsonb,
    false
  )
on conflict (key) do nothing;

update public.system_settings
set value = jsonb_set(
  coalesce(value, '{}'::jsonb),
  '{enabled_languages}',
  coalesce(value -> 'enabled_languages', '["az","en","ru","tr"]'::jsonb),
  true
)
where key = 'interface';

update public.system_settings
set value =
  coalesce(value, '{}'::jsonb)
  || jsonb_build_object(
    'teacher_login_button',
    coalesce(value ->> 'teacher_login_button', ''),
    'student_login_button',
    coalesce(value ->> 'student_login_button', ''),
    'setup_button',
    coalesce(value ->> 'setup_button', ''),
    'login_image_storage_path',
    value ->> 'login_image_storage_path'
  )
where key = 'branding';
