-- Keep questions.media_id synchronized with payload.media_id.
-- This gives the media library a real FK dependency to protect against deleting
-- media that is still used by a question while preserving JSONB portability.

create or replace function public.sync_question_media_id()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  payload_media text;
begin
  payload_media := nullif(new.payload ->> 'media_id', '');

  if payload_media is null then
    new.media_id := null;
  else
    begin
      new.media_id := payload_media::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid payload.media_id UUID';
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_question_media_sync on public.questions;
create trigger trg_question_media_sync
before insert or update of payload on public.questions
for each row execute function public.sync_question_media_id();

update public.questions
set media_id = case
  when nullif(payload ->> 'media_id', '') is null then null
  else (payload ->> 'media_id')::uuid
end;
