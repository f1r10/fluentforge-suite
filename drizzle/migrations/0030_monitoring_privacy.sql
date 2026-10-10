insert into public.system_settings(key, value, is_public)
values (
  'monitoring',
  '{"show_browser_device":true,"show_ip":false}'::jsonb,
  false
)
on conflict (key) do nothing;
