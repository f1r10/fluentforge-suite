create or replace function public.save_language_settings(
  p_languages jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if jsonb_typeof(p_languages) <> 'array' then
    raise exception 'p_languages must be a JSON array';
  end if;

  update public.languages
  set
    is_learning = false,
    is_translation = false;

  insert into public.languages (
    code,
    name,
    native_name,
    is_interface,
    is_learning,
    is_translation,
    sort_order
  )
  select
    lower(trim(x.code)),
    trim(x.name),
    nullif(trim(coalesce(x.native_name, '')), ''),
    false,
    coalesce(x.is_learning, false),
    coalesce(x.is_translation, false),
    100 + x.ordinality::integer
  from jsonb_to_recordset(p_languages) with ordinality as x(
    code text,
    name text,
    native_name text,
    is_learning boolean,
    is_translation boolean,
    ordinality bigint
  )
  where trim(coalesce(x.code, '')) <> ''
    and trim(coalesce(x.name, '')) <> ''
  on conflict (code) do update
  set
    name = excluded.name,
    native_name = excluded.native_name,
    is_learning = excluded.is_learning,
    is_translation = excluded.is_translation,
    sort_order = excluded.sort_order;
end;
$$;

revoke all on function public.save_language_settings(jsonb)
  from public, anon, authenticated;
grant execute on function public.save_language_settings(jsonb)
  to service_role;

create or replace function public.storage_usage_summary()
returns table(
  category text,
  bytes bigint,
  items bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    'media'::text,
    coalesce(sum(size_bytes), 0)::bigint,
    count(*)::bigint
  from public.media_assets
  where storage_path is not null

  union all

  select
    'sources'::text,
    coalesce(sum(size_bytes), 0)::bigint,
    count(*)::bigint
  from public.source_files
  where storage_path is not null

  union all

  select
    'exports'::text,
    coalesce(sum(size_bytes), 0)::bigint,
    count(*)::bigint
  from public.export_jobs
  where storage_path is not null

  union all

  select
    'backups'::text,
    coalesce(sum(size_bytes), 0)::bigint,
    count(*)::bigint
  from public.backups
  where storage_path is not null;
$$;

revoke all on function public.storage_usage_summary()
  from public, anon, authenticated;
grant execute on function public.storage_usage_summary()
  to service_role;
