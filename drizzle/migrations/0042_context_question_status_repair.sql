-- Keep contextual question visibility aligned with its parent reading/listening.
-- Earlier imports could leave an active parent with draft child questions, which
-- made the student practice page render the passage but report no questions.

update public.questions q
set status = r.status
from public.reading_question_sets qs
join public.readings r on r.id = qs.reading_id
where q.reading_question_set_id = qs.id
  and q.deleted_at is null
  and r.deleted_at is null
  and q.status is distinct from r.status;

update public.questions q
set status = l.status
from public.listening_question_sets qs
join public.listenings l on l.id = qs.listening_id
where q.listening_question_set_id = qs.id
  and q.deleted_at is null
  and l.deleted_at is null
  and q.status is distinct from l.status;

notify pgrst, 'reload schema';
