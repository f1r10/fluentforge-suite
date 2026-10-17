-- Reading/listening taxonomy relations.
-- Questions already have their own topic/tag joins; contextual parent content
-- needs independent metadata as well.

create table if not exists public.reading_topics (
  reading_id uuid not null references public.readings(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  primary key (reading_id, topic_id)
);
create index if not exists reading_topics_topic_idx on public.reading_topics(topic_id);

create table if not exists public.reading_tags (
  reading_id uuid not null references public.readings(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (reading_id, tag_id)
);
create index if not exists reading_tags_tag_idx on public.reading_tags(tag_id);

create table if not exists public.listening_topics (
  listening_id uuid not null references public.listenings(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  primary key (listening_id, topic_id)
);
create index if not exists listening_topics_topic_idx on public.listening_topics(topic_id);

create table if not exists public.listening_tags (
  listening_id uuid not null references public.listenings(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (listening_id, tag_id)
);
create index if not exists listening_tags_tag_idx on public.listening_tags(tag_id);

grant select, insert, update, delete on
  public.reading_topics,
  public.reading_tags,
  public.listening_topics,
  public.listening_tags
to authenticated;

grant all on
  public.reading_topics,
  public.reading_tags,
  public.listening_topics,
  public.listening_tags
to service_role;

alter table public.reading_topics enable row level security;
alter table public.reading_tags enable row level security;
alter table public.listening_topics enable row level security;
alter table public.listening_tags enable row level security;

create policy "teacher full access" on public.reading_topics
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher full access" on public.reading_tags
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher full access" on public.listening_topics
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher full access" on public.listening_tags
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
