insert into public.system_settings(key, value, is_public)
values (
  'student_dashboard',
  '{"visible_widgets":["catalogs","exams","practice","today","accuracy","study_time","progress","weak_topics","history","favorites"]}'::jsonb,
  false
)
on conflict (key) do update
set value = jsonb_build_object(
  'visible_widgets',
  coalesce(
    system_settings.value -> 'visible_widgets',
    system_settings.value -> 'widgets',
    '["catalogs","exams","practice","today","accuracy","study_time","progress","weak_topics","history","favorites"]'::jsonb
  )
);
