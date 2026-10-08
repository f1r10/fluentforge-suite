-- Public branding images (logo/favicon) are intentionally world-readable.
-- Browser writes are still brokered through short-lived signed upload URLs.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit
)
values (
  'branding',
  'branding',
  true,
  5242880
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit;
