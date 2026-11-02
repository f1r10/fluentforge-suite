-- A V1 service-only, SECURITY DEFINER lexical lookup is used by the
-- authenticated teacher import workflow. Never grant it to teachers without
-- enforcing the active workspace inside the function: SECURITY DEFINER
-- otherwise bypasses table RLS and leaks other teachers' vocabulary.
create or replace function public.lookup_vocabulary_import_senses(
  _language text,
  _words text[]
)
returns table (
  id uuid, word text, learning_language text,
  part_of_speech text, definition text, notes text, translations jsonb
)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select v.id, v.word, v.learning_language, v.part_of_speech,
    v.definition, v.notes,
    coalesce(jsonb_agg(
      jsonb_build_object('language', t.language, 'value', t.value)
    ) filter (where t.entry_id is not null), '[]'::jsonb)
  from public.vocabulary_entries v
  left join public.vocabulary_translations t on t.entry_id = v.id
  where v.deleted_at is null
    and lower(v.learning_language) = lower(_language)
    and lower(v.word) = any (
      array(select lower(trim(x)) from unnest(_words) as w(x))
    )
    and (
      auth.role() = 'service_role'
      or (
        public.is_teacher()
        and v.workspace_id = public.current_workspace_id()
      )
    )
  group by v.id;
$$;

revoke all on function public.lookup_vocabulary_import_senses(text,text[])
  from public, anon, authenticated;
grant execute on function public.lookup_vocabulary_import_senses(text,text[])
  to authenticated, service_role;

notify pgrst, 'reload schema';
