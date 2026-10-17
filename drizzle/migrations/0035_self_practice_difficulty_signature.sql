-- Remove the superseded 10-argument overload.
-- PostgreSQL otherwise sees both the legacy function and the new
-- difficulty-aware function (whose final argument has a default) as valid
-- candidates for existing 10-argument calls.

drop function if exists public.select_self_practice_question_ids(
  uuid,
  integer,
  text,
  text,
  text[],
  uuid[],
  uuid,
  uuid,
  text,
  boolean
);
